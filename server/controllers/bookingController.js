// server/controllers/bookingController.js
const Booking = require("../models/Booking")
const Event = require("../models/Event")
const { validationResult } = require("express-validator")
const {
  apiResponse,
  getPaginationMeta,
  generateBookingReference,
  calculateRefund,
  catchAsync,
} = require("../utils/helpers")

// Create new booking
exports.createBooking = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const { event: eventId, numberOfTickets, attendeeInfo, specialRequests, paymentMethod } = req.body

  // Check if event exists and is available
  const event = await Event.findOne({
    _id: eventId,
    isActive: true,
    date: { $gte: new Date() },
  })

  if (!event) {
    return res.status(404).json(apiResponse(false, "Event not found or no longer available"))
  }

  // Check if user already has an active booking for this event
  const existingBooking = await Booking.findOne({
    user: req.user.userId,
    event: eventId,
    bookingStatus: { $in: ["confirmed", "pending"] },
  })

  if (existingBooking) {
    return res.status(409).json(apiResponse(false, "You already have an active booking for this event"))
  }

  // Check seat availability
  if (event.availableSeats < numberOfTickets) {
    return res
      .status(400)
      .json(apiResponse(false, `Only ${event.availableSeats} seats available, but ${numberOfTickets} requested`))
  }

  // Check max bookings per user limit
  if (numberOfTickets > event.maxBookingsPerUser) {
    return res
      .status(400)
      .json(apiResponse(false, `Maximum ${event.maxBookingsPerUser} tickets allowed per user for this event`))
  }

  // Calculate total amount
  const totalAmount = event.price * numberOfTickets

  // Create booking
  const bookingData = {
    user: req.user.userId,
    event: eventId,
    numberOfTickets,
    totalAmount,
    bookingReference: generateBookingReference(),
    paymentMethod: paymentMethod || "credit_card",
    paymentStatus: "paid", // In a real app, this would be pending until payment is processed
    bookingStatus: "confirmed",
    attendeeInfo: attendeeInfo || [],
    specialRequests,
  }

  // Start a transaction to ensure data consistency
  const session = await Booking.startSession()
  session.startTransaction()

  try {
    // Create the booking
    const booking = new Booking(bookingData)
    await booking.save({ session })

    // Update event seat availability
    await Event.findByIdAndUpdate(eventId, { $inc: { availableSeats: -numberOfTickets } }, { session })

    await session.commitTransaction()

    // Populate the booking with event and user details
    await booking.populate([
      { path: "event", select: "title date time location price category" },
      { path: "user", select: "name email" },
    ])

    res.status(201).json(apiResponse(true, "Booking created successfully", { booking }))
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    session.endSession()
  }
})

// Get user's bookings
exports.getMyBookings = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const {
    page = 1,
    limit = 10,
    status,
    eventId,
    dateFrom,
    dateTo,
    sortBy = "bookingDate",
    sortOrder = "desc",
  } = req.query

  // Build filter
  const filter = { user: req.user.userId }

  if (status) {
    filter.bookingStatus = status
  }

  if (eventId) {
    filter.event = eventId
  }

  if (dateFrom || dateTo) {
    filter.bookingDate = {}
    if (dateFrom) filter.bookingDate.$gte = new Date(dateFrom)
    if (dateTo) filter.bookingDate.$lte = new Date(dateTo)
  }

  // Build sort
  const sort = {}
  sort[sortBy] = sortOrder === "desc" ? -1 : 1

  // Pagination
  const pageNum = Number.parseInt(page)
  const limitNum = Number.parseInt(limit)
  const skip = (pageNum - 1) * limitNum

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .populate("event", "title date time location price category imageUrl")
      .lean(),
    Booking.countDocuments(filter),
  ])

  // Add calculated fields
  const bookingsWithExtras = bookings.map((booking) => {
    const now = new Date()
    const eventDate = new Date(booking.event.date)
    const daysUntilEvent = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24))

    return {
      ...booking,
      daysUntilEvent: daysUntilEvent > 0 ? daysUntilEvent : 0,
      canCancel: booking.bookingStatus === "confirmed" && daysUntilEvent > 1,
      eligibleRefundAmount:
        booking.bookingStatus === "confirmed"
          ? calculateRefund(booking.totalAmount, booking.event.date, "moderate")
          : 0,
    }
  })

  const meta = getPaginationMeta(pageNum, limitNum, total)

  res.status(200).json(
    apiResponse(
      true,
      "Bookings retrieved successfully",
      {
        bookings: bookingsWithExtras,
        total,
      },
      null,
      meta,
    ),
  )
})

// Get booking by ID
exports.getBookingById = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const { id } = req.params

  const booking = await Booking.findById(id)
    .populate("event", "title date time location price category imageUrl")
    .populate("user", "name email")

  if (!booking) {
    return res.status(404).json(apiResponse(false, "Booking not found"))
  }

  // Check ownership (handled by middleware, but double-check)
  if (req.user.role !== "admin" && booking.user._id.toString() !== req.user.userId) {
    return res.status(403).json(apiResponse(false, "Access denied"))
  }

  // Add calculated fields
  const now = new Date()
  const eventDate = new Date(booking.event.date)
  const daysUntilEvent = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24))

  const bookingWithExtras = {
    ...booking.toObject(),
    daysUntilEvent: daysUntilEvent > 0 ? daysUntilEvent : 0,
    canCancel: booking.bookingStatus === "confirmed" && daysUntilEvent > 1,
    eligibleRefundAmount:
      booking.bookingStatus === "confirmed" ? calculateRefund(booking.totalAmount, booking.event.date, "moderate") : 0,
  }

  res.status(200).json(apiResponse(true, "Booking retrieved successfully", { booking: bookingWithExtras }))
})

// Update booking
exports.updateBooking = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const { id } = req.params
  const { attendeeInfo, specialRequests } = req.body

  const booking = await Booking.findById(id)
  if (!booking) {
    return res.status(404).json(apiResponse(false, "Booking not found"))
  }

  // Check if booking can be updated
  if (booking.bookingStatus !== "confirmed") {
    return res.status(400).json(apiResponse(false, "Only confirmed bookings can be updated"))
  }

  // Check ownership
  if (req.user.role !== "admin" && booking.user.toString() !== req.user.userId) {
    return res.status(403).json(apiResponse(false, "Access denied"))
  }

  // Validate attendee info count if provided
  if (attendeeInfo && attendeeInfo.length !== booking.numberOfTickets) {
    return res
      .status(400)
      .json(
        apiResponse(
          false,
          `Number of attendees (${attendeeInfo.length}) must match number of tickets (${booking.numberOfTickets})`,
        ),
      )
  }

  // Update booking
  const updateData = {}
  if (attendeeInfo) updateData.attendeeInfo = attendeeInfo
  if (specialRequests !== undefined) updateData.specialRequests = specialRequests

  const updatedBooking = await Booking.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  })
    .populate("event", "title date time location price category")
    .populate("user", "name email")

  res.status(200).json(apiResponse(true, "Booking updated successfully", { booking: updatedBooking }))
})

// Cancel booking
exports.cancelBooking = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const { id } = req.params
  const { reason } = req.body

  const booking = await Booking.findById(id).populate("event")
  if (!booking) {
    return res.status(404).json(apiResponse(false, "Booking not found"))
  }

  // Check if booking can be cancelled
  if (booking.bookingStatus !== "confirmed") {
    return res.status(400).json(apiResponse(false, "Only confirmed bookings can be cancelled"))
  }

  // Check ownership
  if (req.user.role !== "admin" && booking.user.toString() !== req.user.userId) {
    return res.status(403).json(apiResponse(false, "Access denied"))
  }

  // Check cancellation deadline (24 hours before event)
  const now = new Date()
  const eventDate = new Date(booking.event.date)
  const hoursUntilEvent = (eventDate - now) / (1000 * 60 * 60)

  if (hoursUntilEvent < 24 && req.user.role !== "admin") {
    return res.status(400).json(apiResponse(false, "Bookings cannot be cancelled less than 24 hours before the event"))
  }

  // Calculate refund amount
  const refundAmount = calculateRefund(booking.totalAmount, booking.event.date, "moderate")

  // Start transaction
  const session = await Booking.startSession()
  session.startTransaction()

  try {
    // Update booking status
    await Booking.findByIdAndUpdate(
      id,
      {
        bookingStatus: "cancelled",
        cancellationDate: new Date(),
        cancellationReason: reason || "Cancelled by user",
        refundAmount,
        paymentStatus: refundAmount > 0 ? "refunded" : "paid",
      },
      { session },
    )

    // Return seats to event
    await Event.findByIdAndUpdate(booking.event._id, { $inc: { availableSeats: booking.numberOfTickets } }, { session })

    await session.commitTransaction()

    res.status(200).json(
      apiResponse(true, "Booking cancelled successfully", {
        refundAmount,
        message:
          refundAmount > 0
            ? `Refund of $${refundAmount.toFixed(2)} will be processed within 3-5 business days`
            : "No refund applicable due to cancellation policy",
      }),
    )
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    session.endSession()
  }
})

// Get booking QR code
exports.getBookingQRCode = catchAsync(async (req, res) => {
  const { id } = req.params

  const booking = await Booking.findById(id).populate("event", "title date time location")
  if (!booking) {
    return res.status(404).json(apiResponse(false, "Booking not found"))
  }

  // Check ownership
  if (req.user.role !== "admin" && booking.user.toString() !== req.user.userId) {
    return res.status(403).json(apiResponse(false, "Access denied"))
  }

  if (booking.bookingStatus !== "confirmed") {
    return res.status(400).json(apiResponse(false, "QR code only available for confirmed bookings"))
  }

  // Generate QR code data
  const qrData = {
    bookingReference: booking.bookingReference,
    eventId: booking.event._id,
    eventTitle: booking.event.title,
    eventDate: booking.event.date,
    numberOfTickets: booking.numberOfTickets,
    attendeeName: booking.attendeeInfo[0]?.name || "N/A",
    validationUrl: `${process.env.CLIENT_URL}/validate-ticket/${booking.bookingReference}`,
  }

  res.status(200).json(
    apiResponse(true, "QR code data generated successfully", {
      qrData,
      qrString: JSON.stringify(qrData),
    }),
  )
})

// Get booking receipt
exports.getBookingReceipt = catchAsync(async (req, res) => {
  const { id } = req.params

  const booking = await Booking.findById(id)
    .populate("event", "title date time location price category")
    .populate("user", "name email")

  if (!booking) {
    return res.status(404).json(apiResponse(false, "Booking not found"))
  }

  // Check ownership
  if (req.user.role !== "admin" && booking.user.toString() !== req.user.userId) {
    return res.status(403).json(apiResponse(false, "Access denied"))
  }

  // Generate receipt data
  const receipt = {
    bookingReference: booking.bookingReference,
    bookingDate: booking.bookingDate,
    event: {
      title: booking.event.title,
      date: booking.event.date,
      time: booking.event.time,
      location: booking.event.location,
      category: booking.event.category,
    },
    customer: {
      name: booking.user.name,
      email: booking.user.email,
    },
    tickets: {
      quantity: booking.numberOfTickets,
      pricePerTicket: booking.event.price,
      totalAmount: booking.totalAmount,
    },
    payment: {
      method: booking.paymentMethod,
      status: booking.paymentStatus,
      transactionId: booking.paymentTransactionId,
    },
    status: booking.bookingStatus,
    attendees: booking.attendeeInfo,
    specialRequests: booking.specialRequests,
  }

  res.status(200).json(apiResponse(true, "Receipt generated successfully", { receipt }))
})

// Get all bookings (Admin only)
exports.getAllBookings = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const {
    page = 1,
    limit = 10,
    status,
    eventId,
    dateFrom,
    dateTo,
    sortBy = "bookingDate",
    sortOrder = "desc",
  } = req.query

  // Build filter
  const filter = {}

  if (status) {
    filter.bookingStatus = status
  }

  if (eventId) {
    filter.event = eventId
  }

  if (dateFrom || dateTo) {
    filter.bookingDate = {}
    if (dateFrom) filter.bookingDate.$gte = new Date(dateFrom)
    if (dateTo) filter.bookingDate.$lte = new Date(dateTo)
  }

  // Build sort
  const sort = {}
  sort[sortBy] = sortOrder === "desc" ? -1 : 1

  // Pagination
  const pageNum = Number.parseInt(page)
  const limitNum = Number.parseInt(limit)
  const skip = (pageNum - 1) * limitNum

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .populate("event", "title date time location price category")
      .populate("user", "name email")
      .lean(),
    Booking.countDocuments(filter),
  ])

  const meta = getPaginationMeta(pageNum, limitNum, total)

  res.status(200).json(
    apiResponse(
      true,
      "All bookings retrieved successfully",
      {
        bookings,
        total,
      },
      null,
      meta,
    ),
  )
})

// Get bookings for specific event (Admin only)
exports.getEventBookings = catchAsync(async (req, res) => {
  const { eventId } = req.params
  const { page = 1, limit = 10, status } = req.query

  // Check if event exists
  const event = await Event.findById(eventId)
  if (!event) {
    return res.status(404).json(apiResponse(false, "Event not found"))
  }

  // Build filter
  const filter = { event: eventId }
  if (status) {
    filter.bookingStatus = status
  }

  // Pagination
  const pageNum = Number.parseInt(page)
  const limitNum = Number.parseInt(limit)
  const skip = (pageNum - 1) * limitNum

  const [bookings, total] = await Promise.all([
    Booking.find(filter).sort({ bookingDate: -1 }).skip(skip).limit(limitNum).populate("user", "name email").lean(),
    Booking.countDocuments(filter),
  ])

  const meta = getPaginationMeta(pageNum, limitNum, total)

  res.status(200).json(
    apiResponse(
      true,
      "Event bookings retrieved successfully",
      {
        event: {
          id: event._id,
          title: event.title,
          date: event.date,
          totalSeats: event.totalSeats,
          availableSeats: event.availableSeats,
        },
        bookings,
        total,
      },
      null,
      meta,
    ),
  )
})

// Process refund (Admin only)
exports.refundBooking = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const { id } = req.params
  const { refundAmount, reason } = req.body

  const booking = await Booking.findById(id).populate("event")
  if (!booking) {
    return res.status(404).json(apiResponse(false, "Booking not found"))
  }

  if (booking.bookingStatus !== "cancelled") {
    return res.status(400).json(apiResponse(false, "Only cancelled bookings can be refunded"))
  }

  if (refundAmount > booking.totalAmount) {
    return res.status(400).json(apiResponse(false, "Refund amount cannot exceed total booking amount"))
  }

  // Update booking with refund information
  const updatedBooking = await Booking.findByIdAndUpdate(
    id,
    {
      refundAmount,
      paymentStatus: refundAmount > 0 ? "refunded" : "paid",
      bookingStatus: "refunded",
      cancellationReason: reason || booking.cancellationReason,
    },
    { new: true },
  )
    .populate("event", "title date")
    .populate("user", "name email")

  res.status(200).json(
    apiResponse(true, "Refund processed successfully", {
      booking: updatedBooking,
      refundAmount,
    }),
  )
})

// Get booking statistics (Admin only)
exports.getBookingStats = catchAsync(async (req, res) => {
  const now = new Date()

  // Basic booking statistics
  const bookingStats = await Booking.aggregate([
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        confirmedBookings: {
          $sum: { $cond: [{ $eq: ["$bookingStatus", "confirmed"] }, 1, 0] },
        },
        cancelledBookings: {
          $sum: { $cond: [{ $eq: ["$bookingStatus", "cancelled"] }, 1, 0] },
        },
        refundedBookings: {
          $sum: { $cond: [{ $eq: ["$bookingStatus", "refunded"] }, 1, 0] },
        },
        totalRevenue: {
          $sum: {
            $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0],
          },
        },
        totalRefunds: { $sum: "$refundAmount" },
        totalTickets: { $sum: "$numberOfTickets" },
        averageBookingValue: { $avg: "$totalAmount" },
        averageTicketsPerBooking: { $avg: "$numberOfTickets" },
      },
    },
  ])

  // Monthly booking trend
  const monthlyTrend = await Booking.aggregate([
    {
      $match: {
        bookingDate: {
          $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1),
        },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$bookingDate" },
          month: { $month: "$bookingDate" },
        },
        count: { $sum: 1 },
        revenue: {
          $sum: {
            $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0],
          },
        },
        tickets: { $sum: "$numberOfTickets" },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ])

  // Payment method breakdown
  const paymentMethodStats = await Booking.aggregate([
    {
      $group: {
        _id: "$paymentMethod",
        count: { $sum: 1 },
        totalAmount: { $sum: "$totalAmount" },
      },
    },
    {
      $sort: { count: -1 },
    },
  ])

  // Recent bookings
  const recentBookings = await Booking.find()
    .sort({ bookingDate: -1 })
    .limit(10)
    .populate("event", "title date")
    .populate("user", "name email")
    .lean()

  res.status(200).json(
    apiResponse(true, "Booking statistics retrieved successfully", {
      overview: bookingStats[0] || {
        totalBookings: 0,
        confirmedBookings: 0,
        cancelledBookings: 0,
        refundedBookings: 0,
        totalRevenue: 0,
        totalRefunds: 0,
        totalTickets: 0,
        averageBookingValue: 0,
        averageTicketsPerBooking: 0,
      },
      monthlyTrend,
      paymentMethodStats,
      recentBookings,
    }),
  )
})

module.exports = exports
