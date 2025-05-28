// server/controllers/authController.js
const jwt = require("jsonwebtoken")
const User = require("../models/User")
const { validationResult } = require("express-validator")
const { apiResponse } = require("../utils/helpers")

// TODO: Move this to config file later
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    issuer: "event-booking-api",
    audience: "event-booking-users",
  })
}

// User registration endpoint
exports.register = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
    }

    const { name, email, password, role } = req.body

    // Check if user exists - this could be optimized with indexes
    const userExists = await User.findOne({ email })
    if (userExists) {
      return res.status(409).json(apiResponse(false, "Email already taken"))
    }

    // Create user object
    const newUserData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
    }

    // Only admins can create admin accounts
    if (role && role === "admin") {
      newUserData.role = "admin"
    }

    const user = new User(newUserData)
    await user.save()

    // Generate auth token
    const authToken = generateToken(user._id)

    // Update login timestamp
    user.lastLogin = new Date()
    await user.save()

    res.status(201).json(
      apiResponse(true, "Account created successfully", {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
        },
        token: authToken,
      }),
    )
  } catch (error) {
    console.error("Registration error:", error)

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json(apiResponse(false, "Email already exists"))
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }))
      return res.status(400).json(apiResponse(false, "Validation failed", null, validationErrors))
    }

    res.status(500).json(apiResponse(false, "Registration failed"))
  }
}

// Login functionality
exports.login = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid input", null, errors.array()))
    }

    const { email, password } = req.body

    // Find user with password field included
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      isActive: true,
    }).select("+password +loginAttempts +lockUntil")

    if (!user) {
      return res.status(401).json(apiResponse(false, "Invalid credentials"))
    }

    // Check account lock status
    if (user.isLocked) {
      return res
        .status(423)
        .json(apiResponse(false, "Account locked due to multiple failed attempts. Try again later."))
    }

    // Verify password
    const passwordMatch = await user.comparePassword(password)
    if (!passwordMatch) {
      // Increment failed attempts
      await user.incLoginAttempts()
      return res.status(401).json(apiResponse(false, "Invalid credentials"))
    }

    // Reset failed attempts on successful login
    if (user.loginAttempts > 0) {
      await user.resetLoginAttempts()
    }

    // Update last login time
    user.lastLogin = new Date()
    await user.save()

    // Create JWT token
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
    res.status(500).json(apiResponse(false, "Login failed"))
  }
}

// Get user profile info
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
    if (!user || !user.isActive) {
      return res.status(404).json(apiResponse(false, "User not found"))
    }

    res.status(200).json(
      apiResponse(true, "Profile data retrieved", {
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
    console.error("Profile fetch error:", error)
    res.status(500).json(apiResponse(false, "Could not fetch profile"))
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

    const updatedUser = await User.findByIdAndUpdate(
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

    if (!updatedUser) {
      return res.status(404).json(apiResponse(false, "User not found"))
    }

    res.status(200).json(apiResponse(true, "Profile updated", { user: updatedUser }))
  } catch (error) {
    console.error("Profile update error:", error)

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }))
      return res.status(400).json(apiResponse(false, "Validation failed", null, validationErrors))
    }

    res.status(500).json(apiResponse(false, "Update failed"))
  }
}

// Change password functionality
exports.changePassword = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
    }

    const { currentPassword, newPassword } = req.body

    // Get user with password
    const user = await User.findById(req.user.userId).select("+password")
    if (!user) {
      return res.status(404).json(apiResponse(false, "User not found"))
    }

    // Check current password
    const isCurrentPasswordCorrect = await user.comparePassword(currentPassword)
    if (!isCurrentPasswordCorrect) {
      return res.status(400).json(apiResponse(false, "Current password is incorrect"))
    }

    // Set new password
    user.password = newPassword
    await user.save()

    res.status(200).json(apiResponse(true, "Password updated successfully"))
  } catch (error) {
    console.error("Password change error:", error)
    res.status(500).json(apiResponse(false, "Password change failed"))
  }
}

// Logout - mainly for logging purposes
exports.logout = async (req, res) => {
  try {
    // In a real app, we might blacklist the token here
    // For now just return success
    res.status(200).json(apiResponse(true, "Logged out successfully"))
  } catch (error) {
    console.error("Logout error:", error)
    res.status(500).json(apiResponse(false, "Logout failed"))
  }
}

module.exports = exports
