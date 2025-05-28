// server/models/Event.js
const mongoose = require("mongoose")

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Event title is required"],
      trim: true,
      minlength: [3, "Title must be at least 3 characters long"],
      maxlength: [100, "Title cannot exceed 100 characters"],
      index: true,
    },
    description: {
      type: String,
      required: [true, "Event description is required"],
      trim: true,
      minlength: [10, "Description must be at least 10 characters long"],
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    date: {
      type: Date,
      required: [true, "Event date is required"],
      validate: {
        validator: (value) => value > new Date(),
        message: "Event date must be in the future",
      },
      index: true,
    },
    time: {
      type: String,
      required: [true, "Event time is required"],
      validate: {
        validator: (value) => /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value),
        message: "Time must be in HH:MM format (24-hour)",
      },
    },
    location: {
      type: String,
      required: [true, "Event location is required"],
      trim: true,
      minlength: [5, "Location must be at least 5 characters long"],
      maxlength: [200, "Location cannot exceed 200 characters"],
      index: true,
    },
    totalSeats: {
      type: Number,
      required: [true, "Total seats is required"],
      min: [1, "Total seats must be at least 1"],
      max: [100000, "Total seats cannot exceed 100,000"],
      validate: {
        validator: Number.isInteger,
        message: "Total seats must be a whole number",
      },
    },
    availableSeats: {
      type: Number,
      required: true,
      min: [0, "Available seats cannot be negative"],
      validate: [
        {
          validator: Number.isInteger,
          message: "Available seats must be a whole number",
        },
        {
          validator: function (value) {
            return value <= this.totalSeats
          },
          message: "Available seats cannot exceed total seats",
        },
      ],
    },
    price: {
      type: Number,
      required: [true, "Event price is required"],
      min: [0, "Price cannot be negative"],
      validate: {
        validator: (value) => Number.isFinite(value) && value >= 0,
        message: "Price must be a valid positive number",
      },
    },
    category: {
      type: String,
      required: [true, "Event category is required"],
      enum: {
        values: ["conference", "workshop", "concert", "sports", "exhibition", "seminar", "networking", "other"],
        message:
          "Category must be one of: conference, workshop, concert, sports, exhibition, seminar, networking, other",
      },
      index: true,
    },
    tags: [
      {
        type: String,
        trim: true,
        maxlength: [30, "Tag cannot exceed 30 characters"],
      },
    ],
    imageUrl: {
      type: String,
      validate: {
        validator: (value) => {
          if (!value) return true // Optional field
          return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(value)
        },
        message: "Image URL must be a valid URL ending with jpg, jpeg, png, gif, or webp",
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Event creator is required"],
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    maxBookingsPerUser: {
      type: Number,
      default: 5,
      min: [1, "Max bookings per user must be at least 1"],
      max: [20, "Max bookings per user cannot exceed 20"],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// Compound indexes for better query performance
eventSchema.index({ date: 1, category: 1 })
eventSchema.index({ location: 1, date: 1 })
eventSchema.index({ createdBy: 1, isActive: 1 })
eventSchema.index({ isActive: 1, date: 1 })
eventSchema.index({ isFeatured: 1, date: 1 })

// Text index for search functionality
eventSchema.index({
  title: "text",
  description: "text",
  location: "text",
  tags: "text",
})

// Virtual for booked seats
eventSchema.virtual("bookedSeats").get(function () {
  return this.totalSeats - this.availableSeats
})

// Virtual for booking percentage
eventSchema.virtual("bookingPercentage").get(function () {
  return Math.round((this.bookedSeats / this.totalSeats) * 100)
})

// Virtual for event status
eventSchema.virtual("status").get(function () {
  const now = new Date()
  const eventDateTime = new Date(`${this.date.toDateString()} ${this.time}`)

  if (eventDateTime < now) {
    return "completed"
  } else if (this.availableSeats === 0) {
    return "sold_out"
  } else if (this.availableSeats < this.totalSeats * 0.1) {
    return "almost_full"
  } else {
    return "available"
  }
})

// Pre-save middleware to set availableSeats initially
eventSchema.pre("save", function (next) {
  if (this.isNew && this.availableSeats === undefined) {
    this.availableSeats = this.totalSeats
  }
  next()
})

// Pre-save middleware to validate date is not in the past
eventSchema.pre("save", function (next) {
  if (this.isModified("date") && this.date <= new Date()) {
    return next(new Error("Event date cannot be in the past"))
  }
  next()
})

// Static method to find upcoming events
eventSchema.statics.findUpcoming = function (limit = 10) {
  return this.find({
    date: { $gte: new Date() },
    isActive: true,
  })
    .sort({ date: 1 })
    .limit(limit)
    .populate("createdBy", "name email")
}

// Static method to find events by category
eventSchema.statics.findByCategory = function (category, limit = 10) {
  return this.find({
    category,
    date: { $gte: new Date() },
    isActive: true,
  })
    .sort({ date: 1 })
    .limit(limit)
    .populate("createdBy", "name email")
}

// Instance method to check if event can be booked
eventSchema.methods.canBeBooked = function (requestedSeats = 1) {
  const now = new Date()
  const eventDateTime = new Date(`${this.date.toDateString()} ${this.time}`)

  return {
    canBook: this.isActive && eventDateTime > now && this.availableSeats >= requestedSeats,
    reason: !this.isActive
      ? "Event is not active"
      : eventDateTime <= now
        ? "Event has already started or passed"
        : this.availableSeats < requestedSeats
          ? "Not enough seats available"
          : "Can book",
  }
}

module.exports = mongoose.model("Event", eventSchema)
