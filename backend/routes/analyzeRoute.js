const express = require("express");
const { analyzeCode } = require("../controllers/analyzeController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/analyze", protect, analyzeCode);

router.get("/history", async (req, res) => {
  const data = await Analysis.find().sort({ createdAt: -1 });
  res.json(data);
});

module.exports = router;
