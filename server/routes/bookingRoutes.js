// server/routes/bookingRoutes.js
const express = require("express")
const { body, query, param } = require("express-validator")
const bookingController = require("../controllers/bookingController")
const { protect } = require("../middleware/auth")
const { adminOrOwner, requireAdmin, logAdminAction } = require("../middleware/adminAuth")

const router = express.Router()

// All routes require authentication
router.use(protect)

// Validation rules
const createBookingValidation = [
  body("event").isMongoId().withMessage("Invalid event ID"),
  body("numberOfTickets").isInt({ min: 1, max: 10 }).withMessage("Number of tickets must be between 1 and 10"),
  body("attendeeInfo")
    .optional()
    .isArray()
    .withMessage("Attendee info must be an array")
    .custom((value, { req }) => {
      if (value && value.length !== req.body.numberOfTickets) {
        throw new Error("Number of attendees must match number of tickets")
      }
      return true
    }),
  body("attendeeInfo.*.name")
    .if(body("attendeeInfo").exists())
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Attendee name is required and must be less than 100 characters"),
  body("attendeeInfo.*.email")
    .if(body("attendeeInfo").exists())
    .optional()
    .isEmail()
    .withMessage("Invalid attendee email"),
  body("attendeeInfo.*.phone")
    .if(body("attendeeInfo").exists())
    .optional()
    .matches(/^[+]?[1-9][\d]{0,15}$/)
    .withMessage("Invalid phone number"),
  body("specialRequests")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Special requests cannot exceed 1000 characters"),
  body("paymentMethod")
    .optional()
    .isIn(["credit_card", "debit_card", "paypal", "bank_transfer", "cash", "other"])
    .withMessage("Invalid payment method"),
]

const updateBookingValidation = [
  body("attendeeInfo").optional().isArray().withMessage("Attendee info must be an array"),
  body("attendeeInfo.*.name")
    .if(body("attendeeInfo").exists())
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Attendee name is required and must be less than 100 characters"),
  body("attendeeInfo.*.email")
    .if(body("attendeeInfo").exists())
    .optional()
    .isEmail()
    .withMessage("Invalid attendee email"),
  body("attendeeInfo.*.phone")
    .if(body("attendeeInfo").exists())
    .optional()
    .matches(/^[+]?[1-9][\d]{0,15}$/)
    .withMessage("Invalid phone number"),
  body("specialRequests")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Special requests cannot exceed 1000 characters"),
]

const cancelBookingValidation = [
  body("reason").optional().isLength({ max: 500 }).withMessage("Cancellation reason cannot exceed 500 characters"),
]

const bookingQueryValidation = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
  query("status")
    .optional()
    .isIn(["confirmed", "cancelled", "pending", "refunded"])
    .withMessage("Invalid booking status"),
  query("eventId").optional().isMongoId().withMessage("Invalid event ID"),
  query("dateFrom").optional().isISO8601().withMessage("dateFrom must be a valid date"),
  query("dateTo").optional().isISO8601().withMessage("dateTo must be a valid date"),
  query("sortBy")
    .optional()
    .isIn(["bookingDate", "totalAmount", "numberOfTickets"])
    .withMessage("sortBy must be one of: bookingDate, totalAmount, numberOfTickets"),
  query("sortOrder").optional().isIn(["asc", "desc"]).withMessage("sortOrder must be asc or desc"),
]

const bookingIdValidation = [param("id").isMongoId().withMessage("Invalid booking ID")]

// User booking routes
router.post("/", createBookingValidation, bookingController.createBooking)
router.get("/my-bookings", bookingQueryValidation, bookingController.getMyBookings)
router.get("/:id", bookingIdValidation, adminOrOwner("user"), bookingController.getBookingById)
router.put("/:id", bookingIdValidation, adminOrOwner("user"), updateBookingValidation, bookingController.updateBooking)
router.post(
  "/:id/cancel",
  bookingIdValidation,
  adminOrOwner("user"),
  cancelBookingValidation,
  bookingController.cancelBooking,
)

// Booking management routes
router.get("/:id/qr-code", bookingIdValidation, adminOrOwner("user"), bookingController.getBookingQRCode)
router.get("/:id/receipt", bookingIdValidation, adminOrOwner("user"), bookingController.getBookingReceipt)

// Admin routes
router.get("/", requireAdmin, bookingQueryValidation, bookingController.getAllBookings)
router.get("/admin/stats", requireAdmin, bookingController.getBookingStats)
router.get("/event/:eventId", requireAdmin, param("eventId").isMongoId(), bookingController.getEventBookings)
router.post(
  "/:id/refund",
  bookingIdValidation,
  requireAdmin,
  logAdminAction("REFUND_BOOKING"),
  body("refundAmount").isFloat({ min: 0 }).withMessage("Refund amount must be a positive number"),
  body("reason").optional().isLength({ max: 500 }).withMessage("Refund reason cannot exceed 500 characters"),
  bookingController.refundBooking,
)

module.exports = router
