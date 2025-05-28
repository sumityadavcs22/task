// server/routes/eventRoutes.js
const express = require("express")
const { body, query, param } = require("express-validator")
const eventController = require("../controllers/eventController")
const { protect, optionalAuth } = require("../middleware/auth")
const { requireAdmin, logAdminAction } = require("../middleware/adminAuth")

const router = express.Router()

// Validation rules
const createEventValidation = [
  body("title").trim().isLength({ min: 3, max: 100 }).withMessage("Title must be between 3 and 100 characters"),
  body("description")
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage("Description must be between 10 and 2000 characters"),
  body("date").isISO8601().withMessage("Please provide a valid date").toDate(),
  body("time")
    .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage("Time must be in HH:MM format (24-hour)"),
  body("location").trim().isLength({ min: 5, max: 200 }).withMessage("Location must be between 5 and 200 characters"),
  body("totalSeats").isInt({ min: 1, max: 100000 }).withMessage("Total seats must be between 1 and 100,000"),
  body("price").isFloat({ min: 0 }).withMessage("Price must be a positive number"),
  body("category")
    .isIn(["conference", "workshop", "concert", "sports", "exhibition", "seminar", "networking", "other"])
    .withMessage("Invalid category"),
  body("tags").optional().isArray().withMessage("Tags must be an array"),
  body("imageUrl")
    .optional()
    .isURL()
    .withMessage("Image URL must be a valid URL")
    .matches(/\.(jpg|jpeg|png|gif|webp)$/i)
    .withMessage("Image must be a valid image file"),
  body("maxBookingsPerUser")
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage("Max bookings per user must be between 1 and 20"),
]

const updateEventValidation = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage("Title must be between 3 and 100 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage("Description must be between 10 and 2000 characters"),
  body("date").optional().isISO8601().withMessage("Please provide a valid date").toDate(),
  body("time")
    .optional()
    .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage("Time must be in HH:MM format (24-hour)"),
  body("location")
    .optional()
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage("Location must be between 5 and 200 characters"),
  body("totalSeats").optional().isInt({ min: 1, max: 100000 }).withMessage("Total seats must be between 1 and 100,000"),
  body("price").optional().isFloat({ min: 0 }).withMessage("Price must be a positive number"),
  body("category")
    .optional()
    .isIn(["conference", "workshop", "concert", "sports", "exhibition", "seminar", "networking", "other"])
    .withMessage("Invalid category"),
  body("tags").optional().isArray().withMessage("Tags must be an array"),
  body("imageUrl")
    .optional()
    .isURL()
    .withMessage("Image URL must be a valid URL")
    .matches(/\.(jpg|jpeg|png|gif|webp)$/i)
    .withMessage("Image must be a valid image file"),
  body("isActive").optional().isBoolean().withMessage("isActive must be a boolean"),
  body("isFeatured").optional().isBoolean().withMessage("isFeatured must be a boolean"),
]

const eventQueryValidation = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
  query("category")
    .optional()
    .isIn(["all", "conference", "workshop", "concert", "sports", "exhibition", "seminar", "networking", "other"])
    .withMessage("Invalid category"),
  query("location").optional().isString().withMessage("Location must be a string"),
  query("dateFrom").optional().isISO8601().withMessage("dateFrom must be a valid date"),
  query("dateTo").optional().isISO8601().withMessage("dateTo must be a valid date"),
  query("priceMin").optional().isFloat({ min: 0 }).withMessage("priceMin must be a positive number"),
  query("priceMax").optional().isFloat({ min: 0 }).withMessage("priceMax must be a positive number"),
  query("sortBy")
    .optional()
    .isIn(["date", "price", "title", "createdAt"])
    .withMessage("sortBy must be one of: date, price, title, createdAt"),
  query("sortOrder").optional().isIn(["asc", "desc"]).withMessage("sortOrder must be asc or desc"),
  query("search").optional().isString().withMessage("search must be a string"),
]

const eventIdValidation = [param("id").isMongoId().withMessage("Invalid event ID")]

// Public routes (no authentication required)
router.get("/", eventQueryValidation, optionalAuth, eventController.getAllEvents)
router.get("/featured", eventController.getFeaturedEvents)
router.get("/upcoming", eventController.getUpcomingEvents)
router.get("/categories", eventController.getCategories)
router.get("/search", eventQueryValidation, eventController.searchEvents)
router.get("/:id", eventIdValidation, optionalAuth, eventController.getEventById)

// Protected routes (authentication required)
router.use(protect)

// Admin only routes
router.post("/", requireAdmin, logAdminAction("CREATE_EVENT"), createEventValidation, eventController.createEvent)

router.put(
  "/:id",
  eventIdValidation,
  requireAdmin,
  logAdminAction("UPDATE_EVENT"),
  updateEventValidation,
  eventController.updateEvent,
)

router.delete("/:id", eventIdValidation, requireAdmin, logAdminAction("DELETE_EVENT"), eventController.deleteEvent)

// Admin routes for event management
router.get("/admin/stats", requireAdmin, eventController.getEventStats)
router.get("/admin/my-events", requireAdmin, eventController.getMyEvents)

module.exports = router
