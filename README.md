# AI Code Reviewer (MERN Stack)

AI Code Reviewer is a full-stack web application that helps developers review source code with a combination of AI feedback and rule-based static analysis.

It provides structured review output (issues, fixes, and score), detects complexity and maintainability risks, and secures access with JWT-based authentication.

## Overview

This project combines:

- **AI-powered analysis** using OpenAI for contextual code review.
- **Static analysis** using parser-based logic (no AI) for complexity and structure checks.
- **Authentication** using JWT for protected review endpoints.
- **MongoDB persistence** through Mongoose for storing application data.

The application is organized into:

- **Frontend**: Next.js + React UI with Monaco Editor for code input.
- **Backend**: Express API for auth, analysis, and data handling.

## Tech Stack

### Frontend

- Next.js
- React
- Tailwind CSS
- Monaco Editor (`@monaco-editor/react`)

### Backend

- Node.js
- Express
- Mongoose
- JWT (`jsonwebtoken`)
- Bcrypt (`bcryptjs`)
- OpenAI SDK
- Tree-sitter (`web-tree-sitter`, `tree-sitter-javascript`)

### Database

- MongoDB Atlas (recommended)

## Features

- **AI-based code analysis (OpenAI)**
  - Returns structured issues with problem, impact, and fix details.
  - Includes practical suggestions and review scoring.

- **Static analysis (complexity detection)**
  - Nested loop detection with complexity estimation (`O(n^2)`).
  - Function length checks (> 30 lines).
  - Function parameter count checks (> 4 parameters).
  - Excessive nesting depth checks (> 3 levels).

- **JWT authentication**
  - User signup and login.
  - Secure token generation and verification.
  - Protected analysis routes for authenticated users.

- **MongoDB storage**
  - User account storage with hashed passwords.
  - Database-backed application data via Mongoose.

## Setup Steps

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd project
```

### 2. Install dependencies

Install backend dependencies:

```bash
cd backend
npm install
```

Install frontend dependencies:

```bash
cd ../frontend
npm install
```

### 3. Configure environment variables

Create or update `backend/.env`:

```env
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_strong_jwt_secret
OPENAI_API_KEY=your_openai_api_key
```

Notes:

- Use credentials with access to your MongoDB cluster/database.
- `JWT_SECRET` should be long and random in production.
- Keep `.env` out of version control.

### 4. Run the backend

```bash
cd backend
npm start
```

Backend runs on:

- `http://localhost:5000`

### 5. Run the frontend

Open a second terminal:

```bash
cd frontend
npm run dev
```

Frontend runs on:

- `http://localhost:3000`

## Core API Endpoints

- `POST /api/auth/signup` - Create account and return JWT token.
- `POST /api/auth/login` - Authenticate and return JWT token.
- `POST /api/analyze` - Protected route for code analysis.

## Authentication Flow

1. Signup or login to receive a JWT token.
2. Send token in request headers for protected routes:

```http
Authorization: Bearer <token>
```

## Future Improvements

- Add refresh tokens and logout invalidation.
- Add role-based access control.
- Add test coverage (unit/integration).
- Add review history dashboard and filtering.
