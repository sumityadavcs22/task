// server/middleware/auth.js
const jwt = require("jsonwebtoken")
const User = require("../models/User")
const { apiResponse } = require("../utils/helpers")

// Main authentication middleware
exports.protect = async (req, res, next) => {
  try {
    let token

    // Extract token from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1]
    }

    if (!token) {
      return res.status(401).json(apiResponse(false, "Access denied. No token provided."))
    }

    try {
      // Verify the JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET)

      // Check if user still exists
      const currentUser = await User.findById(decoded.userId).select("+passwordChangedAt")
      if (!currentUser) {
        return res.status(401).json(apiResponse(false, "The user belonging to this token no longer exists."))
      }

      // Check if user account is active
      if (!currentUser.isActive) {
        return res.status(401).json(apiResponse(false, "Your account has been deactivated."))
      }

      // Check if user changed password after token was issued
      if (currentUser.changedPasswordAfter(decoded.iat)) {
        return res.status(401).json(apiResponse(false, "User recently changed password. Please log in again."))
      }

      // Add user info to request object
      req.user = {
        userId: currentUser._id,
        email: currentUser.email,
        role: currentUser.role,
        name: currentUser.name,
      }

      next()
    } catch (jwtError) {
      if (jwtError.name === "TokenExpiredError") {
        return res.status(401).json(apiResponse(false, "Token has expired. Please log in again."))
      } else if (jwtError.name === "JsonWebTokenError") {
        return res.status(401).json(apiResponse(false, "Invalid token. Please log in again."))
      } else {
        throw jwtError
      }
    }
  } catch (error) {
    console.error("Auth middleware error:", error)
    return res.status(500).json(apiResponse(false, "Authentication error"))
  }
}

// Optional authentication - doesn't fail if no token provided
exports.optionalAuth = async (req, res, next) => {
  try {
    let token

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1]
    }

    if (!token) {
      return next() // Continue without authentication
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await User.findById(decoded.userId)

      if (user && user.isActive && !user.changedPasswordAfter(decoded.iat)) {
        req.user = {
          userId: user._id,
          email: user.email,
          role: user.role,
          name: user.name,
        }
      }
    } catch (jwtError) {
      // Silently fail for optional auth - just log it
      console.log("Optional auth failed:", jwtError.message)
    }

    next()
  } catch (error) {
    console.error("Optional auth middleware error:", error)
    next() // Continue even if there's an error
  }
}

// Role-based access control
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json(apiResponse(false, "Authentication required"))
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json(apiResponse(false, "You do not have permission to perform this action"))
    }

    next()
  }
}

// Check resource ownership or admin access
exports.checkOwnership = (resourceUserField = "user") => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json(apiResponse(false, "Authentication required"))
    }

    // Admins can access any resource
    if (req.user.role === "admin") {
      return next()
    }

    // Check if user owns the resource
    const resource = req.resource || req.body
    if (resource && resource[resourceUserField]) {
      const resourceUserId = resource[resourceUserField].toString()
      const currentUserId = req.user.userId.toString()

      if (resourceUserId !== currentUserId) {
        return res.status(403).json(apiResponse(false, "You can only access your own resources"))
      }
    }

    next()
  }
}

module.exports = exports
