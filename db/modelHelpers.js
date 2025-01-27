const { RespondedTweet, BotState } = require("./models");

// Bot State Helper Functions
const getBotState = async () => {
  try {
    // Get the first and only bot state document, or create if doesn't exist
    let botState = await BotState.findOne();

    if (!botState) {
      // Get the last tweet ID from your existing bot-state.json for initial migration
      botState = await BotState.create({
        lastProcessed: Date.now(),
        lastMentionTweetId: "1883814593333760097", // Start from beginning if no state exists
      });
    }

    return botState;
  } catch (error) {
    console.error("Error getting bot state:", error);
    throw error;
  }
};

const updateBotState = async (updates) => {
  try {
    const botState = await BotState.findOne();

    if (!botState) {
      return await BotState.create({
        lastProcessed: updates.lastProcessed || Date.now(),
        lastMentionTweetId: updates.lastMentionTweetId || "1883814593333760097",
      });
    }

    if (updates.lastMentionTweetId) {
      botState.lastMentionTweetId = updates.lastMentionTweetId;
    }
    if (updates.lastProcessed) {
      botState.lastProcessed = updates.lastProcessed;
    }

    await botState.save();
    return botState;
  } catch (error) {
    console.error("Error updating bot state:", error);
    throw error;
  }
};

// Responded Tweets Helper Functions
const addRespondedTweet = async (tweetId) => {
  try {
    const tweet = await RespondedTweet.create({
      mentioned_conversation_tweet_id: tweetId,
    });
    return tweet;
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key error
      console.log("Tweet already marked as responded:", tweetId);
      return null;
    }
    console.error("Error adding responded tweet:", error);
    throw error;
  }
};

const hasRespondedToTweet = async (tweetId) => {
  try {
    const tweet = await RespondedTweet.findOne({
      mentioned_conversation_tweet_id: tweetId,
    });
    return !!tweet;
  } catch (error) {
    console.error("Error checking responded tweet:", error);
    throw error;
  }
};

const getRespondedTweets = async () => {
  try {
    return await RespondedTweet.find().sort({ createdAt: -1 });
  } catch (error) {
    console.error("Error getting responded tweets:", error);
    throw error;
  }
};

// Migration helper
const migrateExistingData = async (alreadyRespondedData, botStateData) => {
  try {
    // Migrate already responded tweets
    const respondedPromises = alreadyRespondedData.map((tweet) =>
      addRespondedTweet(tweet.mentioned_conversation_tweet_id)
    );
    await Promise.all(respondedPromises);

    // Migrate bot state
    await updateBotState({
      lastProcessed: botStateData.lastProcessed,
      lastMentionTweetId: botStateData.lastMentionTweetId,
    });

    console.log("Data migration completed successfully");
  } catch (error) {
    console.error("Error during data migration:", error);
    throw error;
  }
};

module.exports = {
  getBotState,
  updateBotState,
  addRespondedTweet,
  hasRespondedToTweet,
  getRespondedTweets,
  migrateExistingData,
};
