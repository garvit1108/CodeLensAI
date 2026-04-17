# CodeLens AI

Hybrid AI + rule-based code review with precise, line-level insights and actionable fixes.

---

## 🚀 What it does

CodeLens AI is an intelligent code review tool that analyzes your code and provides line-by-line issues, explanations, and concrete fixes.

It combines deterministic rule-based checks with AI to ensure reliable and actionable feedback instead of generic suggestions.

---

## 🔥 Features

- Hybrid analysis (rule-based + AI)
- Line-level issue detection with editor highlighting
- Actionable fixes (before/after code)
- Refactored code with side-by-side comparison
- Learning mode for guided hints
- Follow-up Q&A based on your code and analysis
- Confidence-based issue prioritization
- Graceful fallback when AI is unavailable

---

## ⚙️ How it works

1. User submits code
2. Rule engine checks basic issues (syntax, null access, loops, etc.)
3. AI analyzes deeper logic and improvements
4. Results are normalized into a structured format
5. UI displays issues, suggestions, and refactored code

---

## 🛠️ Tech Stack

- Frontend: Next.js, Tailwind CSS, Monaco Editor
- Backend: Express.js
- Database: MongoDB
- AI: LLM-based analysis (with fallback handling)

---

## ▶️ Setup

```bash
# frontend
cd frontend
npm install
npm run dev

# backend
cd backend
npm install
npm run dev
```
