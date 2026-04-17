const mongoose = require("mongoose");

const analysisSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    issues: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    suggestions: {
	  type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    hints: {
      type: [
        {
          line: {
            type: Number,
          },
          step1: {
            type: String,
          },
          step2: {
            type: String,
          },
          step3: {
            type: String,
          },
        },
      ],
      default: [],
    },
    refactoredCode: {
      type: String,
      default: "",
    },
    score: {
	  type: Number,
	  default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Analysis", analysisSchema);