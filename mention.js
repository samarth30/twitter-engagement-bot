const { TwitterApi } = require("twitter-api-v2");
require("dotenv").config();
const axios = require("axios");
const {
  hasRespondedToTweet,
  addRespondedTweet,
  updateBotState,
} = require("./db/modelHelpers");

const port = process.env.PORT || 3001;
const TWITTER_USERNAME = "@MuseOfTruth"; // Replace with your bot's username

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

// Add at the top of mention.js
const RETRY_DELAY = 60 * 1000; // 1 minute
const MAX_RETRIES = 3;
const MAX_DELAY = 1000 * Math.pow(2, MAX_RETRIES);

const getBackoffDelay = (retryCount) => {
  return Math.min(1000 * Math.pow(2, retryCount), MAX_DELAY);
};

// Replace checkAlreadyResponded with MongoDB version
const checkAlreadyResponded = async (mentionedConversationTweetId) => {
  try {
    return await hasRespondedToTweet(mentionedConversationTweetId);
  } catch (error) {
    console.error("Error checking if already responded:", error);
    return false;
  }
};

// Modify respondToTweet to use MongoDB
const respondToTweet = async (tweetId, message, retryCount = 0) => {
  try {
    if (await checkAlreadyResponded(tweetId)) return;

    const response = await v2Client.reply(message, tweetId);

    if (response.data.id) {
      await addRespondedTweet(tweetId);
    }
  } catch (error) {
    if (error.code === 429 && retryCount < MAX_RETRIES) {
      const backoffDelay = getBackoffDelay(retryCount);
      console.log(`Rate limit hit. Backing off for ${backoffDelay / 1000}s`);
      await delay(backoffDelay);
      return respondToTweet(tweetId, message, retryCount + 1);
    }
    error.isRateLimit = error.code === 429;
    throw error;
  }
};

// Function to get the conversation tweet for a mention
const getMentionConversationTweet = async (mention) => {
  // Check if mention has a conversation_id and if it's not null

  if (mention.conversation_id) {
    const conversationTweet = await v2Client.singleTweet(
      mention.conversation_id,
      {
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
      }
    );
    return conversationTweet;
  }
  return null;
};

// generate response with eliza
const generateResponse = async (text) => {
  const response = await axios.post(
    process.env.ELIZA_ENDPOINT + "MuseofTruth/message",
    {
      text: text,
    }
  );

  console.log(response.data);
  return (
    response.data?.length > 0 && response.data[response.data?.length - 1].text
  );
};

// Modify respondToDirectMentions to use MongoDB
const respondToDirectMentions = async (mentions) => {
  if (mentions.length > 0) {
    mentions = mentions;
  }

  const validTweetIds = [];
  const mentionedConversationTweets = [];

  for (const tweet of mentions) {
    const { text, entities, id, conversation_id, author_id } = tweet;

    if (author_id === userData.id) {
      continue;
    }

    const museMention = entities.mentions.find(
      (mention) => mention.username === "MuseOfTruth"
    );

    if (conversation_id === tweet.id) {
      console.log("conversation_id");
      console.log(conversation_id);
      validTweetIds.push(id);
      const response = await generateResponse(text);
      console.log(text);
      console.log("--------------------------------");
      console.log(response);
      console.log("--------------------------------");
      await respondToTweet(id, response);
      await updateBotState({
        lastProcessed: Date.now(),
        lastMentionTweetId: id,
      });
      continue;
    }

    try {
      const mentionedConversationTweet =
        await getMentionConversationTweet(tweet);
      mentionedConversationTweets.push(mentionedConversationTweet);

      if (mentionedConversationTweet) {
        console.log("mentionedConversationTweet");
        console.log(mentionedConversationTweet);

        const combinedText =
          mentionedConversationTweet?.data?.text + " " + text;
        const response = await generateResponse(combinedText);
        console.log(combinedText);
        console.log("--------------------------------");
        console.log(response);
        console.log("--------------------------------");
        await respondToTweet(id, response);
        await updateBotState({
          lastProcessed: Date.now(),
          lastMentionTweetId: id,
        });
      }
    } catch (error) {
      console.log(error);
      continue;
    }

    // delay for 2 seconds
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  return validTweetIds;
};

// Fetch and log valid tweet IDs
// const validTweetIds = respondToDirectMentions();
// console.log("Valid Tweet IDs:", validTweetIds);

module.exports = {
  respondToDirectMentions,
};
