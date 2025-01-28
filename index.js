const { TwitterApi, ApiResponseError } = require("twitter-api-v2");
require("dotenv").config();
const express = require("express");
const cron = require("node-cron");
const { respondToDirectMentions } = require("./mention");
const connectDB = require("./db/db");
const { getBotState, updateBotState } = require("./db/modelHelpers");

const app = express();
const port = process.env.PORT || 3001;

// Initialize Twitter client with v2 API
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET_KEY,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const v2Client = client.v2;

const userData = {
  id: process.env.TWITTER_USER_ID,
  name: "Muse of Truth (AI Fact-Checker) 🌿",
  username: "MuseOfTruth",
};

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to handle rate limit errors
const handleRateLimit = async (error) => {
  if (
    error instanceof ApiResponseError &&
    error.rateLimitError &&
    error.rateLimit
  ) {
    const resetTime = error.rateLimit.reset * 1000;
    const currentTime = Date.now();
    const waitTime = resetTime - currentTime + 1000;

    console.log(`Rate limit hit. Waiting for ${waitTime / 1000} seconds...`);
    await delay(waitTime);
    return true;
  }
  return false;
};

// Fetch mentions function
const fetchMentions = async (lastMentionTweetId = null) => {
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
      since_id: lastMentionTweetId,
      "user.fields": ["name", "username"],
      expansions: ["author_id", "referenced_tweets.id"],
      max_results: 100,
    });

    return mentions;
  } catch (error) {
    if (await handleRateLimit(error)) {
      return fetchMentions(lastMentionTweetId);
    }
    console.error("Error fetching mentions:", error);
    throw error;
  }
};

// Add a flag to track if initialization is in progress
let isInitializationInProgress = false;

// Add at the top with other constants
let lastSuccessfulRun = null;

// Modify the initializeBot function
const initializeBot = async () => {
  // If already running, skip this execution
  if (isInitializationInProgress) {
    console.log("Previous batch still processing, skipping this run");
    return;
  }

  try {
    isInitializationInProgress = true;
    const botState = await getBotState();
    console.log("Running bot initialization at:", new Date().toISOString());

    const existingMentions = await fetchMentions(botState.lastMentionTweetId);
    console.log(
      "Fetched mentions:",
      existingMentions?._realData?.data?.length || 0
    );

    if (existingMentions?._realData?.data?.length > 0) {
      await respondToDirectMentions(existingMentions._realData.data);
    }

    await updateBotState({
      lastProcessed: Date.now(),
      lastMentionTweetId: existingMentions?._realData?.meta?.newest_id,
    });

    // Add in initializeBot before the finally block
    lastSuccessfulRun = Date.now();
    console.log(`Batch completed. Time since last successful run: ${
      lastSuccessfulRun 
        ? Math.floor((Date.now() - lastSuccessfulRun) / 1000) 
        : 'N/A'
    } seconds`);
  } catch (error) {
    console.error("Error initializing bot:", error);
    await delay(60000); // 1 minute delay before retry
  } finally {
    isInitializationInProgress = false;
  }
};

// Update cron schedule to run every 15 seconds
cron.schedule("*/15 * * * * *", async () => {
  console.log("Running scheduled bot check");
  await initializeBot();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    lastCheck: new Date().toISOString(),
  });
});

// Connect to MongoDB and start server
connectDB()
  .then(() => {
    console.log("MongoDB Connected");
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
      initializeBot(); // Initial run
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err);
  });

// Error handling
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
