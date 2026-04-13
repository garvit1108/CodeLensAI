require("dotenv").config();


const connectDB = require("./config/db");
connectDB(); 

const express = require("express");
const cors = require("cors");
const analyzeRoute = require("./routes/analyzeRoute");
const authRoutes = require("./routes/authRoutes");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use("/api", analyzeRoute);
app.use("/api/auth", authRoutes);

app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
