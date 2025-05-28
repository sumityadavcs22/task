// server/config/database.js
const mongoose = require("mongoose")

class Database {
  constructor() {
    this.connection = null
    this.isConnected = false
  }

  async connect() {
    try {
      // Prevent multiple connections
      if (this.isConnected) {
        console.log("Database already connected")
        return this.connection
      }

      const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/eventbooking"

      // Connection options
      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10, // Maintain up to 10 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
        bufferCommands: false, // Disable mongoose buffering
        bufferMaxEntries: 0, // Disable mongoose buffering
      }

      // Connect to MongoDB
      this.connection = await mongoose.connect(mongoURI, options)

      this.isConnected = true

      console.log(`✅ MongoDB Connected: ${this.connection.connection.host}`)
      console.log(`📊 Database: ${this.connection.connection.name}`)

      // Connection event listeners
      this.setupEventListeners()

      return this.connection
    } catch (error) {
      console.error("❌ MongoDB connection error:", error.message)
      this.isConnected = false
      throw error
    }
  }

  setupEventListeners() {
    const db = mongoose.connection

    db.on("error", (error) => {
      console.error("❌ MongoDB connection error:", error)
      this.isConnected = false
    })

    db.on("disconnected", () => {
      console.log("⚠️ MongoDB disconnected")
      this.isConnected = false
    })

    db.on("reconnected", () => {
      console.log("✅ MongoDB reconnected")
      this.isConnected = true
    })

    db.on("close", () => {
      console.log("🔒 MongoDB connection closed")
      this.isConnected = false
    })

    // Handle application termination
    process.on("SIGINT", async () => {
      await this.disconnect()
      process.exit(0)
    })

    process.on("SIGTERM", async () => {
      await this.disconnect()
      process.exit(0)
    })
  }

  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.connection.close()
        this.isConnected = false
        console.log("✅ MongoDB connection closed gracefully")
      }
    } catch (error) {
      console.error("❌ Error closing MongoDB connection:", error)
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      states: {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting",
      },
    }
  }

  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { status: "disconnected", message: "Database not connected" }
      }

      // Simple ping to check if database is responsive
      await mongoose.connection.db.admin().ping()

      return {
        status: "healthy",
        message: "Database connection is healthy",
        details: this.getConnectionStatus(),
      }
    } catch (error) {
      return {
        status: "unhealthy",
        message: "Database health check failed",
        error: error.message,
      }
    }
  }

  async getStats() {
    try {
      if (!this.isConnected) {
        throw new Error("Database not connected")
      }

      const stats = await mongoose.connection.db.stats()
      return {
        database: stats.db,
        collections: stats.collections,
        objects: stats.objects,
        avgObjSize: stats.avgObjSize,
        dataSize: stats.dataSize,
        storageSize: stats.storageSize,
        indexes: stats.indexes,
        indexSize: stats.indexSize,
      }
    } catch (error) {
      throw new Error(`Failed to get database stats: ${error.message}`)
    }
  }

  async createIndexes() {
    try {
      console.log("🔍 Creating database indexes...")

      // User indexes
      await mongoose.connection.collection("users").createIndex({ email: 1 }, { unique: true })
      await mongoose.connection.collection("users").createIndex({ role: 1 })
      await mongoose.connection.collection("users").createIndex({ isActive: 1 })

      // Event indexes
      await mongoose.connection.collection("events").createIndex({ date: 1, category: 1 })
      await mongoose.connection.collection("events").createIndex({ location: 1, date: 1 })
      await mongoose.connection.collection("events").createIndex({ createdBy: 1, isActive: 1 })
      await mongoose.connection.collection("events").createIndex({ isActive: 1, date: 1 })
      await mongoose.connection.collection("events").createIndex({ isFeatured: 1, date: 1 })

      // Booking indexes
      await mongoose.connection.collection("bookings").createIndex({ user: 1, bookingStatus: 1 })
      await mongoose.connection.collection("bookings").createIndex({ event: 1, bookingStatus: 1 })
      await mongoose.connection.collection("bookings").createIndex({ bookingDate: -1 })
      await mongoose.connection.collection("bookings").createIndex({ bookingReference: 1 }, { unique: true })

      console.log("✅ Database indexes created successfully")
    } catch (error) {
      console.error("❌ Error creating indexes:", error.message)
    }
  }
}

// Export singleton instance
module.exports = new Database()
