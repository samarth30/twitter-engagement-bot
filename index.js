const { TwitterApi, ApiResponseError } = require("twitter-api-v2");
require("dotenv").config();
const express = require("express");
const cron = require("node-cron");
const { respondToDirectMentions } = require("./mention");
const connectDB = require("./db/db");
const {
  getBotState,
  updateBotState,
  hasRespondedToTweet,
} = require("./db/modelHelpers");
const EventEmitter = require('events');

const app = express();
const port = process.env.PORT || 3001;
const TWITTER_USERNAME = "@MuseOfTruth"; // Replace with your bot's username

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes in milliseconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 60 * 1000; // 1 minute delay between retries

// Queue for handling mentions
let mentionsQueue = [];
let isProcessing = false;

// Enhanced queue management
const taskQueue = new EventEmitter();
const runningTasks = new Set();

// Initialize Twitter client with v2 API
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET_KEY,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

// Get v1 and v2 clients
const v1Client = client.v1;
const v2Client = client.v2;

// Optional: Get read-only, read-write clients if needed
const readOnlyClient = client.readOnly;
const readWriteClient = client.readWrite;

const userData = {
  id: "1860097956789256193",
  name: "Muse of Truth (AI Fact-Checker) 🌿",
  username: "MuseOfTruth",
};
// Verify credentials and get current user (optional)
const getCurrentUser = async () => {
  try {
    const { id, username } = userData;

    // const currentUser = await v1Client.currentUser();
    const currentUser = await v2Client.me();
    console.log("Current user:", currentUser);
    return currentUser;
  } catch (error) {
    console.error("Error getting current user:", error);
    throw error;
  }
};

// getCurrentUser();

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to handle rate limit errors
const handleRateLimit = async (error) => {
  if (
    error instanceof ApiResponseError &&
    error.rateLimitError &&
    error.rateLimit
  ) {
    const resetTime = error.rateLimit.reset * 1000; // Convert to milliseconds
    const currentTime = Date.now();
    const waitTime = resetTime - currentTime + 1000; // Add 1 second buffer

    console.log(`Rate limit hit. Waiting for ${waitTime / 1000} seconds...`);
    await delay(waitTime);
    return true;
  }
  return false;
};

// Modified fetchMentions without file writing
const fetchMentions = async (lastMentionTweetId = null, retryCount = 0) => {
  try {
    const mentions = await v2Client.userMentionTimeline(userData.id, {
      "tweet.fields": [
        "created_at",
        "author_id",
        "conversation_id",
        "in_reply_to_user_id",
        "referenced_tweets",
        "text",
        "entities",
        "attachments",
      ],
      // start_time: startTime,
      since_id: lastMentionTweetId,
      "user.fields": ["name", "username"],
      expansions: ["author_id", "referenced_tweets.id"],
      max_results: 100,
    });

    return mentions;
  } catch (error) {
    if (await handleRateLimit(error)) {
      if (retryCount < MAX_RETRIES) {
        console.log(
          `Retrying fetch mentions (attempt ${retryCount + 1}/${MAX_RETRIES})`
        );
        await delay(RETRY_DELAY);
        return fetchMentions(retryCount + 1);
      }
    }
    console.error("Error fetching mentions:", error);
    throw error;
  }
};

// Queue processor function
const processMentionsQueue = async () => {
  if (isProcessing || mentionsQueue.length === 0) return;

  isProcessing = true;
  try {
    while (mentionsQueue.length > 0) {
      const mentions = mentionsQueue[0];
      try {
        await respondToDirectMentions(mentions);
        // Only remove after successful processing
        mentionsQueue.shift();
      } catch (error) {
        console.error("Error processing mentions:", error);
        if (!error.isRateLimit) {
          // Move failed mentions to error queue or log them
          const failedMention = mentionsQueue.shift();
          console.log("Failed mention:", failedMention);
          // fs.appendFileSync(
          //   "failed-mentions.json",
          //   JSON.stringify(failedMention) + "\n"
          // );
        }
        await delay(RETRY_DELAY);
      }
    }
  } finally {
    isProcessing = false;
  }
};

// Generate unique task IDs
const generateTaskId = () => {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Modified initializeBot with task tracking
const initializeBot = async (taskId) => {
  try {
    console.log(`Starting bot initialization for task ${taskId}`);
    const botState = await getBotState();
    
    const existingMentions = await fetchMentions(botState.lastMentionTweetId);
    console.log(`Task ${taskId}: Fetched ${existingMentions?._realData?.data?.length || 0} mentions`);

    if (processMentionsResponse(existingMentions)) {
      await processMentionsQueue();
    }

    await updateBotState({
      lastProcessed: Date.now(),
      lastMentionTweetId: existingMentions?._realData?.meta?.newest_id,
    });
    
    console.log(`Completed bot initialization for task ${taskId}`);
  } catch (error) {
    console.error(`Error in task ${taskId}:`, error);
    throw error;
  }
};

// Task processor
taskQueue.on("processTask", async (taskId) => {
  try {
    await initializeBot(taskId);
  } catch (error) {
    console.error(`Task ${taskId} failed:`, error);
  } finally {
    runningTasks.delete(taskId);
    isProcessing = runningTasks.size > 0;
    
    if (runningTasks.size === 0) {
      console.log("All tasks completed");
    }
  }
});

// Modified cron schedule with queue management
cron.schedule("*/5 * * * *", async () => {
  const taskId = generateTaskId();
  
  if (isProcessing) {
    console.log(`Previous task still running. Current task ${taskId} queued.`);
    return;
  }

  runningTasks.add(taskId);
  isProcessing = true;
  
  console.log(`Starting new task ${taskId}. Active tasks: ${runningTasks.size}`);
  taskQueue.emit("processTask", taskId);
});

// Enhanced health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    queueLength: mentionsQueue.length,
    isProcessing,
    activeTasks: Array.from(runningTasks),
    activeTaskCount: runningTasks.size
  });
});

const processMentionsResponse = (mentions) => {
  if (!mentions?._realData?.data) {
    console.log("No valid mentions data");
    return false;
  }
  if (
    Array.isArray(mentions._realData.data) &&
    mentions._realData.data.length > 0
  ) {
    mentionsQueue.push(mentions);
    return true;
  }
  return false;
};

// Connect to MongoDB before starting the server
connectDB()
  .then(() => {
    // ... rest of your server initialization code ...
    console.log("Server starting after MongoDB connection");
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
      initializeBot();
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err);
  });

process.on("uncaughtException", async (error) => {
  console.error("Uncaught Exception:", error);
  // Log error, save state, etc.
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Log error, save state, etc.
});

// Graceful shutdown handling
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM. Cleaning up...");
  if (runningTasks.size > 0) {
    console.log(`Waiting for ${runningTasks.size} tasks to complete...`);
    // Wait for tasks to complete or implement force shutdown after timeout
  }
  process.exit(0);
});
