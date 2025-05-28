// server/middleware/adminAuth.js
const { apiResponse } = require("../utils/helpers")

// Middleware to check if user is admin
exports.requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(apiResponse(false, "Authentication required"))
  }

  if (req.user.role !== "admin") {
    return res.status(403).json(apiResponse(false, "Admin access required"))
  }

  next()
}

// Middleware to check if user is admin or owner
exports.adminOrOwner = (userIdField = "userId") => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json(apiResponse(false, "Authentication required"))
    }

    // Admin can access anything
    if (req.user.role === "admin") {
      return next()
    }

    // Check if user is the owner
    const resourceUserId = req.params[userIdField] || req.body[userIdField]
    if (resourceUserId && resourceUserId.toString() === req.user.userId.toString()) {
      return next()
    }

    return res.status(403).json(apiResponse(false, "Access denied. Admin privileges or ownership required."))
  }
}

// Middleware to log admin actions
exports.logAdminAction = (action) => {
  return (req, res, next) => {
    if (req.user && req.user.role === "admin") {
      console.log(`Admin Action: ${action} by ${req.user.email} at ${new Date().toISOString()}`)
      console.log(`Request: ${req.method} ${req.originalUrl}`)
      if (Object.keys(req.body).length > 0) {
        console.log(`Body:`, JSON.stringify(req.body, null, 2))
      }
    }
    next()
  }
}

module.exports = exports
