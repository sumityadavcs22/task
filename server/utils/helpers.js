// server/utils/helpers.js
const mongoose = require("mongoose")

/**
 * Standard API response format
 * @param {boolean} success - Operation success status
 * @param {string} message - Response message
 * @param {any} data - Response data (optional)
 * @param {array} errors - Error array (optional)
 * @param {object} meta - Metadata like pagination (optional)
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
 * Pagination metadata helper
 */
exports.getPaginationMeta = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit)
  const hasNext = page < totalPages
  const hasPrev = page > 1

  return {
    pagination: {
      currentPage: page,
      totalPages,
      totalItems: total,
      itemsPerPage: limit,
      hasNextPage: hasNext,
      hasPrevPage: hasPrev,
      nextPage: hasNext ? page + 1 : null,
      prevPage: hasPrev ? page - 1 : null,
    },
  }
}

/**
 * Check if string is valid MongoDB ObjectId
 */
exports.isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id)
}

/**
 * Generate random string - useful for references
 */
exports.generateRandomString = (length = 8, charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") => {
  let result = ""
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length))
  }
  return result
}

/**
 * Generate unique booking reference
 */
exports.generateBookingReference = () => {
  const timestamp = Date.now().toString().slice(-6)
  const randomPart = exports.generateRandomString(4)
  return `BK${timestamp}${randomPart}`
}

/**
 * Calculate days between two dates
 */
exports.daysDifference = (date1, date2) => {
  const diffTime = Math.abs(date2 - date1)
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * Format currency amount
 */
exports.formatCurrency = (amount, currency = "USD") => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(amount)
}

/**
 * Basic input sanitization
 */
exports.sanitizeInput = (input) => {
  if (typeof input !== "string") return input
  return input.trim().replace(/[<>]/g, "")
}

/**
 * Create URL-friendly slug from text
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
 * Check if date is in future
 */
exports.isFutureDate = (date) => {
  return new Date(date) > new Date()
}

/**
 * Get time remaining until target date
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
 * Simple email validation
 */
exports.isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Phone number validation
 */
exports.isValidPhone = (phone) => {
  const phoneRegex = /^[+]?[1-9][\d]{0,15}$/
  return phoneRegex.test(phone.replace(/[\s()-]/g, ""))
}

/**
 * Calculate refund based on cancellation policy
 * Different policies: flexible, moderate, strict, no_refund
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
 * Async error handler wrapper
 */
exports.catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}

/**
 * Filter object to only include allowed fields
 */
exports.filterObj = (obj, ...allowedFields) => {
  const newObj = {}
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el]
  })
  return newObj
}

module.exports = exports
