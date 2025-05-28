// server/server.js
const express = require("express")
const mongoose = require("mongoose")
const cors = require("cors")
const dotenv = require("dotenv")
const rateLimit = require("express-rate-limit")
const helmet = require("helmet")
const morgan = require("morgan")
const compression = require("compression")

// Load environment variables first
dotenv.config()

// Import route handlers
const authRoutes = require("./routes/authroutes")
const eventRoutes = require("./routes/eventRoutes")
const bookingRoutes = require("./routes/bookingRoutes")

const app = express()

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
)

// Gzip compression
app.use(compression())

// Request logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"))
} else {
  app.use(morgan("combined"))
}

// Rate limiting - adjust based on needs
const limiter = rateLimit({
  windowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
})
app.use("/api/", limiter)

// CORS setup
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [process.env.CLIENT_URL, "http://localhost:3000", "http://localhost:3001"].filter(Boolean)

      // Allow requests with no origin (mobile apps, etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error("Not allowed by CORS"))
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

// Body parsing middleware
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      try {
        JSON.parse(buf)
      } catch (e) {
        res.status(400).json({
          success: false,
          message: "Invalid JSON format",
        })
        throw new Error("Invalid JSON")
      }
    },
  }),
)
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Database connection function
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    })

    console.log(`MongoDB Connected: ${conn.connection.host}`)

    // Connection event handlers
    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err)
    })

    mongoose.connection.on("disconnected", () => {
      console.log("MongoDB disconnected")
    })
  } catch (error) {
    console.error("Database connection failed:", error)
    process.exit(1)
  }
}

// Initialize database connection
connectDB()

// API route setup
app.use("/api/auth", authRoutes)
app.use("/api/events", eventRoutes)
app.use("/api/bookings", bookingRoutes)

// Health check route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  })
})

// Root route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Event Booking System API",
    version: "1.0.0",
    documentation: "/api/docs",
  })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error("Error Stack:", err.stack)

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }))
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors,
    })
  }

  // Duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0]
    return res.status(409).json({
      success: false,
      message: `${field} already exists`,
    })
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    })
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token expired",
    })
  }

  // CORS error
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "CORS policy violation",
    })
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  })
})

// 404 handler for undefined routes
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  })
})

// Graceful shutdown handlers
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully")
  await mongoose.connection.close()
  process.exit(0)
})

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully")
  await mongoose.connection.close()
  process.exit(0)
})

const PORT = process.env.PORT || 5000

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`)
  console.log(`Health check: http://localhost:${PORT}/api/health`)
})

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err)
  server.close(() => {
    process.exit(1)
  })
})

module.exports = app
