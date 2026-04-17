const express = require("express");
const {
  analyzeCode,
  followUpQuestion,
} = require("../controllers/analyzeController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/analyze", protect, analyzeCode);
router.post("/follow-up", protect, followUpQuestion);

module.exports = router;
