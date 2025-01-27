const mongoose = require("mongoose");

// Schema for alreadyResponded
const RespondedTweetSchema = new mongoose.Schema(
  {
    mentioned_conversation_tweet_id: {
      type: String,
      required: true,
      unique: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt timestamps
  }
);

// Schema for bot-state
const BotStateSchema = new mongoose.Schema(
  {
    lastProcessed: {
      type: Number,
      required: true,
    },
    lastMentionTweetId: {
      type: String,
      required: true,
      default: "1883814593333760097", // Provide a default value or remove required
    },
  },
  {
    timestamps: true,
  }
);

// Create models
const RespondedTweet = mongoose.model("RespondedTweet", RespondedTweetSchema);
const BotState = mongoose.model("BotState", BotStateSchema);

module.exports = {
  RespondedTweet,
  BotState,
};
