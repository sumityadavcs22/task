// server/utils/helpers.js
const mongoose = require("mongoose")

/**
 * Standard API response format
 * @param {boolean} success - Whether the operation was successful
 * @param {string} message - Response message
 * @param {any} data - Response data
 * @param {array} errors - Array of error objects
 * @param {object} meta - Additional metadata (pagination, etc.)
 * @returns {object} Formatted response object
 */
exports.apiResponse = (success, message, data = null, errors = null, meta = null) => {
  const response = {
    success,
    message,
    timestamp: new Date().toISOString(),
  }

  if (data !== null) {
    response.data = data
  }

  if (errors !== null && Array.isArray(errors) && errors.length > 0) {
    response.errors = errors
  }

  if (meta !== null) {
    response.meta = meta
  }

  return response
}

/**
 * Pagination helper
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @param {number} total - Total number of items
 * @returns {object} Pagination metadata
 */
exports.getPaginationMeta = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit)
  const hasNextPage = page < totalPages
  const hasPrevPage = page > 1

  return {
    pagination: {
      currentPage: page,
      totalPages,
      totalItems: total,
      itemsPerPage: limit,
      hasNextPage,
      hasPrevPage,
      nextPage: hasNextPage ? page + 1 : null,
      prevPage: hasPrevPage ? page - 1 : null,
    },
  }
}

/**
 * Validate MongoDB ObjectId
 * @param {string} id - ID to validate
 * @returns {boolean} Whether the ID is valid
 */
exports.isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id)
}

/**
 * Generate random string
 * @param {number} length - Length of the string
 * @param {string} charset - Character set to use
 * @returns {string} Random string
 */
exports.generateRandomString = (length = 8, charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") => {
  let result = ""
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length))
  }
  return result
}

/**
 * Generate booking reference
 * @returns {string} Unique booking reference
 */
exports.generateBookingReference = () => {
  const timestamp = Date.now().toString().slice(-6)
  const random = exports.generateRandomString(4)
  return `BK${timestamp}${random}`
}

/**
 * Calculate date difference in days
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {number} Difference in days
 */
exports.daysDifference = (date1, date2) => {
  const diffTime = Math.abs(date2 - date1)
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * Format currency
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code
 * @returns {string} Formatted currency string
 */
exports.formatCurrency = (amount, currency = "USD") => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(amount)
}

/**
 * Sanitize user input
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
exports.sanitizeInput = (input) => {
  if (typeof input !== "string") return input
  return input.trim().replace(/[<>]/g, "")
}

/**
 * Generate slug from string
 * @param {string} text - Text to convert to slug
 * @returns {string} URL-friendly slug
 */
exports.generateSlug = (text) => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Check if date is in the future
 * @param {Date} date - Date to check
 * @returns {boolean} Whether the date is in the future
 */
exports.isFutureDate = (date) => {
  return new Date(date) > new Date()
}

/**
 * Get time until date
 * @param {Date} date - Target date
 * @returns {object} Time until date in various units
 */
exports.getTimeUntil = (date) => {
  const now = new Date()
  const target = new Date(date)
  const diff = target - now

  if (diff <= 0) {
    return { isPast: true, message: "Date has passed" }
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  return {
    isPast: false,
    totalMilliseconds: diff,
    days,
    hours,
    minutes,
    message: `${days} days, ${hours} hours, ${minutes} minutes`,
  }
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} Whether the email is valid
 */
exports.isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Validate phone number format
 * @param {string} phone - Phone number to validate
 * @returns {boolean} Whether the phone number is valid
 */
exports.isValidPhone = (phone) => {
  const phoneRegex = /^[+]?[1-9][\d]{0,15}$/
  return phoneRegex.test(phone.replace(/[\s()-]/g, ""))
}

/**
 * Calculate refund amount based on cancellation policy
 * @param {number} totalAmount - Original booking amount
 * @param {Date} eventDate - Event date
 * @param {string} policy - Cancellation policy
 * @returns {number} Refund amount
 */
exports.calculateRefund = (totalAmount, eventDate, policy = "moderate") => {
  const now = new Date()
  const hoursUntilEvent = (new Date(eventDate) - now) / (1000 * 60 * 60)

  switch (policy) {
    case "flexible":
      if (hoursUntilEvent >= 24) return totalAmount
      if (hoursUntilEvent >= 2) return totalAmount * 0.5
      return 0
    case "moderate":
      if (hoursUntilEvent >= 48) return totalAmount
      if (hoursUntilEvent >= 24) return totalAmount * 0.5
      return 0
    case "strict":
      if (hoursUntilEvent >= 168) return totalAmount // 7 days
      if (hoursUntilEvent >= 72) return totalAmount * 0.5 // 3 days
      return 0
    case "no_refund":
      return 0
    default:
      return 0
  }
}

/**
 * Handle async errors in Express routes
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware function
 */
exports.catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}

/**
 * Filter object by allowed fields
 * @param {object} obj - Object to filter
 * @param {array} allowedFields - Array of allowed field names
 * @returns {object} Filtered object
 */
exports.filterObj = (obj, ...allowedFields) => {
  const newObj = {}
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el]
  })
  return newObj
}

module.exports = exports
