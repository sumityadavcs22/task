// server/routes/authRoutes.js
const express = require("express")
const { body } = require("express-validator")
const authController = require("../controllers/authController")
const { protect } = require("../middleware/auth")

const router = express.Router()

// Validation rules
const registerValidation = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("Name can only contain letters and spaces"),
  body("email").isEmail().normalizeEmail().withMessage("Please provide a valid email"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long")
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage("Password must contain at least one letter and one number"),
  body("role").optional().isIn(["user", "admin"]).withMessage("Role must be either user or admin"),
]

const loginValidation = [
  body("email").isEmail().normalizeEmail().withMessage("Please provide a valid email"),
  body("password").notEmpty().withMessage("Password is required"),
]

const updateProfileValidation = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("Name can only contain letters and spaces"),
]

const changePasswordValidation = [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters long")
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage("New password must contain at least one letter and one number"),
]

// Public routes
router.post("/register", registerValidation, authController.register)
router.post("/login", loginValidation, authController.login)

// Protected routes
router.use(protect) // All routes after this middleware are protected

router.get("/profile", authController.getProfile)
router.put("/profile", updateProfileValidation, authController.updateProfile)
router.put("/change-password", changePasswordValidation, authController.changePassword)
router.post("/logout", authController.logout)

module.exports = router
