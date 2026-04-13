const mongoose = require("mongoose");

const analysisSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
  },
  issues: {
    type: [Object],
    default: [],
  },
  suggestions: {
    type: [String],
    default: [],
  },
  complexity: {
    type: String,
  },
}, { timestamps: true });

module.exports = mongoose.model("Analysis", analysisSchema);