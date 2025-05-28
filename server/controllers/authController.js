// server/controllers/authController.js
const jwt = require("jsonwebtoken")
const User = require("../models/User")
const { validationResult } = require("express-validator")
const { apiResponse } = require("../utils/helpers")

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    issuer: "event-booking-api",
    audience: "event-booking-users",
  })
}

// Register new user
exports.register = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
    }

    const { name, email, password, role } = req.body

    // Check if user already exists
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(409).json(apiResponse(false, "User with this email already exists"))
    }

    // Create new user
    const userData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: role || "user",
    }

    const user = new User(userData)
    await user.save()

    // Generate token
    const token = generateToken(user._id)

    // Update last login
    user.lastLogin = new Date()
    await user.save()

    res.status(201).json(
      apiResponse(true, "User registered successfully", {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
        },
        token,
      }),
    )
  } catch (error) {
    console.error("Registration error:", error)

    // Handle specific mongoose errors
    if (error.code === 11000) {
      return res.status(409).json(apiResponse(false, "Email already exists"))
    }

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }))
      return res.status(400).json(apiResponse(false, "Validation failed", null, validationErrors))
    }

    res.status(500).json(apiResponse(false, "Internal server error during registration"))
  }
}

// Login user
exports.login = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
    }

    const { email, password } = req.body

    // Find user and include password for comparison
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      isActive: true,
    }).select("+password +loginAttempts +lockUntil")

    if (!user) {
      return res.status(401).json(apiResponse(false, "Invalid email or password"))
    }

    // Check if account is locked
    if (user.isLocked) {
      return res
        .status(423)
        .json(
          apiResponse(
            false,
            "Account is temporarily locked due to too many failed login attempts. Please try again later.",
          ),
        )
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password)
    if (!isPasswordValid) {
      // Increment login attempts
      await user.incLoginAttempts()

      return res.status(401).json(apiResponse(false, "Invalid email or password"))
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0) {
      await user.resetLoginAttempts()
    }

    // Update last login
    user.lastLogin = new Date()
    await user.save()

    // Generate token
    const token = generateToken(user._id)

    res.status(200).json(
      apiResponse(true, "Login successful", {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          lastLogin: user.lastLogin,
        },
        token,
      }),
    )
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json(apiResponse(false, "Internal server error during login"))
  }
}

// Get current user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
    if (!user || !user.isActive) {
      return res.status(404).json(apiResponse(false, "User not found"))
    }

    res.status(200).json(
      apiResponse(true, "Profile retrieved successfully", {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      }),
    )
  } catch (error) {
    console.error("Get profile error:", error)
    res.status(500).json(apiResponse(false, "Internal server error"))
  }
}

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
    }

    const { name } = req.body

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      {
        name: name.trim(),
        updatedAt: new Date(),
      },
      {
        new: true,
        runValidators: true,
      },
    )

    if (!user) {
      return res.status(404).json(apiResponse(false, "User not found"))
    }

    res.status(200).json(apiResponse(true, "Profile updated successfully", { user }))
  } catch (error) {
    console.error("Update profile error:", error)

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }))
      return res.status(400).json(apiResponse(false, "Validation failed", null, validationErrors))
    }

    res.status(500).json(apiResponse(false, "Internal server error"))
  }
}

// Change password
exports.changePassword = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
    }

    const { currentPassword, newPassword } = req.body

    // Find user with password
    const user = await User.findById(req.user.userId).select("+password")
    if (!user) {
      return res.status(404).json(apiResponse(false, "User not found"))
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword)
    if (!isCurrentPasswordValid) {
      return res.status(400).json(apiResponse(false, "Current password is incorrect"))
    }

    // Update password
    user.password = newPassword
    await user.save()

    res.status(200).json(apiResponse(true, "Password changed successfully"))
  } catch (error) {
    console.error("Change password error:", error)
    res.status(500).json(apiResponse(false, "Internal server error"))
  }
}

// Logout user (client-side token removal, but we can log it)
exports.logout = async (req, res) => {
  try {
    // In a more sophisticated setup, you might want to blacklist the token
    // For now, we'll just send a success response
    res.status(200).json(apiResponse(true, "Logged out successfully"))
  } catch (error) {
    console.error("Logout error:", error)
    res.status(500).json(apiResponse(false, "Internal server error"))
  }
}

module.exports = exports
