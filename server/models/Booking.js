// server/models/Booking.js
const mongoose = require("mongoose")

const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required for booking"],
      index: true,
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: [true, "Event is required for booking"],
      index: true,
    },
    numberOfTickets: {
      type: Number,
      required: [true, "Number of tickets is required"],
      min: [1, "Must book at least 1 ticket"],
      max: [10, "Cannot book more than 10 tickets at once"],
      validate: {
        validator: Number.isInteger,
        message: "Number of tickets must be a whole number",
      },
    },
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: [0, "Total amount cannot be negative"],
      validate: {
        validator: (value) => Number.isFinite(value) && value >= 0,
        message: "Total amount must be a valid positive number",
      },
    },
    bookingStatus: {
      type: String,
      enum: {
        values: ["confirmed", "cancelled", "pending", "refunded"],
        message: "Booking status must be one of: confirmed, cancelled, pending, refunded",
      },
      default: "confirmed",
      index: true,
    },
    bookingReference: {
      type: String,
      unique: true,
      required: true,
      uppercase: true,
      validate: {
        validator: (value) => /^BK[A-Z0-9]{8,12}$/.test(value),
        message: "Invalid booking reference format",
      },
    },
    paymentStatus: {
      type: String,
      enum: {
        values: ["paid", "pending", "failed", "refunded", "partial"],
        message: "Payment status must be one of: paid, pending, failed, refunded, partial",
      },
      default: "pending",
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["credit_card", "debit_card", "paypal", "bank_transfer", "cash", "other"],
      default: "credit_card",
    },
    paymentTransactionId: {
      type: String,
      sparse: true, // Allows multiple null values
    },
    bookingDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    cancellationDate: {
      type: Date,
    },
    cancellationReason: {
      type: String,
      maxlength: [500, "Cancellation reason cannot exceed 500 characters"],
      trim: true,
    },
    refundAmount: {
      type: Number,
      min: [0, "Refund amount cannot be negative"],
      validate: {
        validator: function (value) {
          if (value === undefined || value === null) return true
          return Number.isFinite(value) && value >= 0 && value <= this.totalAmount
        },
        message: "Refund amount must be valid and not exceed total amount",
      },
    },
    attendeeInfo: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
          maxlength: [100, "Attendee name cannot exceed 100 characters"],
        },
        email: {
          type: String,
          validate: {
            validator: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
            message: "Please provide a valid email for attendee",
          },
        },
        phone: {
          type: String,
          validate: {
            validator: (value) => {
              if (!value) return true // Optional field
              return /^[+]?[1-9][\d]{0,15}$/.test(value)
            },
            message: "Please provide a valid phone number",
          },
        },
      },
    ],
    specialRequests: {
      type: String,
      maxlength: [1000, "Special requests cannot exceed 1000 characters"],
      trim: true,
    },
    qrCode: {
      type: String, // Will store QR code data or URL
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// Compound indexes for better query performance
bookingSchema.index({ user: 1, bookingStatus: 1 })
bookingSchema.index({ event: 1, bookingStatus: 1 })
bookingSchema.index({ bookingDate: -1 })
bookingSchema.index({ bookingReference: 1 })
bookingSchema.index({ paymentStatus: 1, bookingStatus: 1 })

// Unique compound index to prevent duplicate active bookings
bookingSchema.index(
  { user: 1, event: 1 },
  {
    unique: true,
    partialFilterExpression: {
      bookingStatus: { $in: ["confirmed", "pending"] },
    },
  },
)

// Virtual for days until event
bookingSchema.virtual("daysUntilEvent").get(function () {
  if (!this.populated("event") || !this.event.date) return null

  const now = new Date()
  const eventDate = new Date(this.event.date)
  const diffTime = eventDate - now
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return diffDays > 0 ? diffDays : 0
})

// Virtual for booking age in days
bookingSchema.virtual("bookingAge").get(function () {
  const now = new Date()
  const bookingDate = new Date(this.bookingDate)
  const diffTime = now - bookingDate
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

  return diffDays
})

// Virtual for can cancel status
bookingSchema.virtual("canCancel").get(function () {
  if (this.bookingStatus !== "confirmed") return false
  if (!this.populated("event") || !this.event.date) return false

  const now = new Date()
  const eventDate = new Date(this.event.date)
  const hoursUntilEvent = (eventDate - now) / (1000 * 60 * 60)

  return hoursUntilEvent >= 24 // Can cancel if more than 24 hours before event
})

// Pre-save middleware to generate booking reference
bookingSchema.pre("save", function (next) {
  if (!this.bookingReference) {
    const timestamp = Date.now().toString().slice(-6)
    const random = Math.random().toString(36).substring(2, 6).toUpperCase()
    this.bookingReference = `BK${timestamp}${random}`
  }
  next()
})

// Pre-save middleware to validate attendee info
bookingSchema.pre("save", function (next) {
  if (this.attendeeInfo && this.attendeeInfo.length > 0) {
    if (this.attendeeInfo.length !== this.numberOfTickets) {
      return next(new Error("Number of attendees must match number of tickets"))
    }
  }
  next()
})

// Pre-save middleware to set cancellation date
bookingSchema.pre("save", function (next) {
  if (this.isModified("bookingStatus") && this.bookingStatus === "cancelled" && !this.cancellationDate) {
    this.cancellationDate = new Date()
  }
  next()
})

// Static method to find user's active bookings
bookingSchema.statics.findActiveByUser = function (userId) {
  return this.find({
    user: userId,
    bookingStatus: { $in: ["confirmed", "pending"] },
  })
    .populate("event", "title date time location")
    .sort({ bookingDate: -1 })
}

// Static method to find bookings for an event
bookingSchema.statics.findByEvent = function (eventId, status = null) {
  const query = { event: eventId }
  if (status) query.bookingStatus = status

  return this.find(query).populate("user", "name email").sort({ bookingDate: -1 })
}

// Instance method to calculate refund amount
bookingSchema.methods.calculateRefund = function () {
  if (!this.populated("event") || !this.event.date) return 0

  const now = new Date()
  const eventDate = new Date(this.event.date)
  const hoursUntilEvent = (eventDate - now) / (1000 * 60 * 60)

  if (hoursUntilEvent >= 168) {
    // 7 days
    return this.totalAmount // Full refund
  } else if (hoursUntilEvent >= 72) {
    // 3 days
    return this.totalAmount * 0.75 // 75% refund
  } else if (hoursUntilEvent >= 24) {
    // 1 day
    return this.totalAmount * 0.5 // 50% refund
  } else {
    return 0 // No refund
  }
}

// Instance method to generate QR code data
bookingSchema.methods.generateQRData = function () {
  return {
    bookingReference: this.bookingReference,
    eventId: this.event._id || this.event,
    userId: this.user._id || this.user,
    numberOfTickets: this.numberOfTickets,
    bookingDate: this.bookingDate,
  }
}

module.exports = mongoose.model("Booking", bookingSchema)
