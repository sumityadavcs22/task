// server/models/User.js
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const validator = require("validator")

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [50, "Name too long"],
      validate: {
        validator: (value) => /^[a-zA-Z\s]+$/.test(value),
        message: "Name can only contain letters and spaces",
      },
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      validate: [validator.isEmail, "Please provide a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // Don't include in queries by default
      validate: {
        validator: (password) => {
          // Basic password validation - at least one letter and one number
          return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{6,}$/.test(password)
        },
        message: "Password must contain at least one letter and one number",
      },
    },
    role: {
      type: String,
      enum: {
        values: ["user", "admin"],
        message: "Role must be either user or admin",
      },
      default: "user",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    passwordChangedAt: {
      type: Date,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.password
        delete ret.__v
        delete ret.loginAttempts
        delete ret.lockUntil
        return ret
      },
    },
  },
)

// Create indexes for better performance
userSchema.index({ email: 1 })
userSchema.index({ role: 1 })
userSchema.index({ isActive: 1 })

// Virtual property for checking if account is locked
userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now())
})

// Pre-save hook to hash password
userSchema.pre("save", async function (next) {
  // Only hash if password was modified
  if (!this.isModified("password")) return next()

  try {
    // Hash password with salt rounds of 12
    const salt = await bcrypt.genSalt(12)
    this.password = await bcrypt.hash(this.password, salt)

    // Set password changed timestamp if not new user
    if (!this.isNew) {
      this.passwordChangedAt = Date.now() - 1000 // Subtract 1 second for token timing
    }

    next()
  } catch (error) {
    next(error)
  }
})

// Instance method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword) return false
  return await bcrypt.compare(candidatePassword, this.password)
}

// Check if password was changed after JWT token was issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = Number.parseInt(this.passwordChangedAt.getTime() / 1000, 10)
    return JWTTimestamp < changedTimestamp
  }
  return false
}

// Increment login attempts and lock account if needed
userSchema.methods.incLoginAttempts = function () {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    })
  }

  const updates = { $inc: { loginAttempts: 1 } }

  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 } // 2 hours lock
  }

  return this.updateOne(updates)
}

// Reset login attempts after successful login
userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
  })
}

module.exports = mongoose.model("User", userSchema)
