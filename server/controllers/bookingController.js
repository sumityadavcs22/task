// server/controllers/bookingController.js
const Booking = require("../models/Booking")
const Event = require("../models/Event")
const { validationResult } = require("express-validator")
const { apiResponse, getPaginationMeta, generateBookingReference, calculateRefund } = require("../utils/helpers")

// Create a new booking
exports.createBooking = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Please check your booking details", null, errors.array()))
    }

    const { event: eventId, numberOfTickets, attendeeInfo, specialRequests, paymentMethod } = req.body

    // Verify event availability
    const targetEvent = await Event.findOne({
      _id: eventId,
      isActive: true,
      date: { $gte: new Date() },
    })

    if (!targetEvent) {
      return res.status(404).json(apiResponse(false, "This event is no longer available for booking"))
    }

    // Check for duplicate bookings
    const duplicateBooking = await Booking.findOne({
      user: req.user.userId,
      event: eventId,
      bookingStatus: { $in: ["confirmed", "pending"] },
    })

    if (duplicateBooking) {
      return res.status(409).json(apiResponse(false, "You already have tickets for this event"))
    }

    // Validate seat availability
    if (targetEvent.availableSeats < numberOfTickets) {
      return res
        .status(400)
        .json(
          apiResponse(
            false,
            `Sorry, only ${targetEvent.availableSeats} tickets remaining (you requested ${numberOfTickets})`,
          ),
        )
    }

    // Check per-user booking limits
    if (numberOfTickets > targetEvent.maxBookingsPerUser) {
      return res
        .status(400)
        .json(apiResponse(false, `Maximum ${targetEvent.maxBookingsPerUser} tickets allowed per person for this event`))
    }

    // Calculate pricing
    const bookingTotal = targetEvent.price * numberOfTickets

    // Prepare booking data
    const bookingDetails = {
      user: req.user.userId,
      event: eventId,
      numberOfTickets,
      totalAmount: bookingTotal,
      bookingReference: generateBookingReference(),
      paymentMethod: paymentMethod || "credit_card",
      paymentStatus: "paid", // Simplified - in production this would be "pending" until payment gateway confirms
      bookingStatus: "confirmed",
      attendeeInfo: attendeeInfo || [],
      specialRequests,
    }

    // Use database transaction for consistency
    const dbSession = await Booking.startSession()
    dbSession.startTransaction()

    try {
      // Save the booking
      const newBooking = new Booking(bookingDetails)
      await newBooking.save({ session: dbSession })

      // Update event capacity
      await Event.findByIdAndUpdate(eventId, { $inc: { availableSeats: -numberOfTickets } }, { session: dbSession })

      await dbSession.commitTransaction()

      // Load complete booking details
      await newBooking.populate([
        { path: "event", select: "title date time location price category" },
        { path: "user", select: "name email" },
      ])

      return res.status(201).json(apiResponse(true, "Booking confirmed successfully!", { booking: newBooking }))
    } catch (transactionError) {
      await dbSession.abortTransaction()
      throw transactionError
    } finally {
      dbSession.endSession()
    }
  } catch (error) {
    console.error("Booking creation error:", error)
    return res.status(500).json(apiResponse(false, "Unable to process your booking at this time"))
  }
}

// Get user's booking history
exports.getMyBookings = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid request parameters", null, errors.array()))
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

    // Build query filter
    const queryFilter = { user: req.user.userId }

    if (status) {
      queryFilter.bookingStatus = status
    }

    if (eventId) {
      queryFilter.event = eventId
    }

    if (dateFrom || dateTo) {
      queryFilter.bookingDate = {}
      if (dateFrom) queryFilter.bookingDate.$gte = new Date(dateFrom)
      if (dateTo) queryFilter.bookingDate.$lte = new Date(dateTo)
    }

    // Configure sorting
    const sortConfig = {}
    sortConfig[sortBy] = sortOrder === "desc" ? -1 : 1

    // Setup pagination
    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skipCount = (pageNum - 1) * limitNum

    const [userBookings, totalBookings] = await Promise.all([
      Booking.find(queryFilter)
        .sort(sortConfig)
        .skip(skipCount)
        .limit(limitNum)
        .populate("event", "title date time location price category imageUrl")
        .lean(),
      Booking.countDocuments(queryFilter),
    ])

    // Enhance bookings with calculated fields
    const enhancedBookings = userBookings.map((booking) => {
      const currentTime = new Date()
      const eventDateTime = new Date(booking.event.date)
      const daysRemaining = Math.ceil((eventDateTime - currentTime) / (1000 * 60 * 60 * 24))

      return {
        ...booking,
        daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
        canBeCancelled: booking.bookingStatus === "confirmed" && daysRemaining > 1,
        potentialRefund:
          booking.bookingStatus === "confirmed"
            ? calculateRefund(booking.totalAmount, booking.event.date, "moderate")
            : 0,
      }
    })

    const paginationData = getPaginationMeta(pageNum, limitNum, totalBookings)

    return res.status(200).json(
      apiResponse(
        true,
        "Your bookings loaded successfully",
        {
          bookings: enhancedBookings,
          totalCount: totalBookings,
        },
        null,
        paginationData,
      ),
    )
  } catch (error) {
    console.error("Error loading user bookings:", error)
    return res.status(500).json(apiResponse(false, "Unable to load your bookings"))
  }
}

// Get specific booking details
exports.getBookingById = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid booking ID format", null, errors.array()))
    }

    const bookingId = req.params.id

    const bookingDetails = await Booking.findById(bookingId)
      .populate("event", "title date time location price category imageUrl")
      .populate("user", "name email")

    if (!bookingDetails) {
      return res.status(404).json(apiResponse(false, "Booking not found"))
    }

    // Verify access permissions
    if (req.user.role !== "admin" && bookingDetails.user._id.toString() !== req.user.userId) {
      return res.status(403).json(apiResponse(false, "You can only view your own bookings"))
    }

    // Calculate time-sensitive information
    const currentTime = new Date()
    const eventDateTime = new Date(bookingDetails.event.date)
    const daysRemaining = Math.ceil((eventDateTime - currentTime) / (1000 * 60 * 60 * 24))

    const enrichedBooking = {
      ...bookingDetails.toObject(),
      daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
      canBeCancelled: bookingDetails.bookingStatus === "confirmed" && daysRemaining > 1,
      potentialRefund:
        bookingDetails.bookingStatus === "confirmed"
          ? calculateRefund(bookingDetails.totalAmount, bookingDetails.event.date, "moderate")
          : 0,
    }

    return res.status(200).json(apiResponse(true, "Booking details retrieved", { booking: enrichedBooking }))
  } catch (error) {
    console.error("Error loading booking details:", error)
    return res.status(500).json(apiResponse(false, "Unable to load booking details"))
  }
}

// Update booking information
exports.updateBooking = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid update data", null, errors.array()))
    }

    const bookingId = req.params.id
    const { attendeeInfo, specialRequests } = req.body

    const existingBooking = await Booking.findById(bookingId)
    if (!existingBooking) {
      return res.status(404).json(apiResponse(false, "Booking not found"))
    }

    // Verify booking can be modified
    if (existingBooking.bookingStatus !== "confirmed") {
      return res.status(400).json(apiResponse(false, "Only confirmed bookings can be modified"))
    }

    // Check access permissions
    if (req.user.role !== "admin" && existingBooking.user.toString() !== req.user.userId) {
      return res.status(403).json(apiResponse(false, "You can only modify your own bookings"))
    }

    // Validate attendee information if provided
    if (attendeeInfo && attendeeInfo.length !== existingBooking.numberOfTickets) {
      return res
        .status(400)
        .json(
          apiResponse(
            false,
            `Attendee count (${attendeeInfo.length}) must match ticket count (${existingBooking.numberOfTickets})`,
          ),
        )
    }

    // Prepare update data
    const updateFields = {}
    if (attendeeInfo) updateFields.attendeeInfo = attendeeInfo
    if (specialRequests !== undefined) updateFields.specialRequests = specialRequests

    const updatedBooking = await Booking.findByIdAndUpdate(bookingId, updateFields, {
      new: true,
      runValidators: true,
    })
      .populate("event", "title date time location price category")
      .populate("user", "name email")

    return res.status(200).json(apiResponse(true, "Booking updated successfully", { booking: updatedBooking }))
  } catch (error) {
    console.error("Error updating booking:", error)
    return res.status(500).json(apiResponse(false, "Unable to update booking"))
  }
}

// Cancel an existing booking
exports.cancelBooking = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid cancellation request", null, errors.array()))
    }

    const bookingId = req.params.id
    const { reason } = req.body

    const targetBooking = await Booking.findById(bookingId).populate("event")
    if (!targetBooking) {
      return res.status(404).json(apiResponse(false, "Booking not found"))
    }

    // Verify cancellation eligibility
    if (targetBooking.bookingStatus !== "confirmed") {
      return res.status(400).json(apiResponse(false, "Only confirmed bookings can be cancelled"))
    }

    // Check access permissions
    if (req.user.role !== "admin" && targetBooking.user.toString() !== req.user.userId) {
      return res.status(403).json(apiResponse(false, "You can only cancel your own bookings"))
    }

    // Enforce cancellation deadline (24 hours for regular users)
    const currentTime = new Date()
    const eventDateTime = new Date(targetBooking.event.date)
    const hoursUntilEvent = (eventDateTime - currentTime) / (1000 * 60 * 60)

    if (hoursUntilEvent < 24 && req.user.role !== "admin") {
      return res.status(400).json(apiResponse(false, "Cancellations must be made at least 24 hours before the event"))
    }

    // Calculate refund based on policy
    const refundAmount = calculateRefund(targetBooking.totalAmount, targetBooking.event.date, "moderate")

    // Process cancellation with transaction
    const dbSession = await Booking.startSession()
    dbSession.startTransaction()

    try {
      // Update booking status
      await Booking.findByIdAndUpdate(
        bookingId,
        {
          bookingStatus: "cancelled",
          cancellationDate: new Date(),
          cancellationReason: reason || "Cancelled by user",
          refundAmount,
          paymentStatus: refundAmount > 0 ? "refunded" : "paid",
        },
        { session: dbSession },
      )

      // Release seats back to event
      await Event.findByIdAndUpdate(
        targetBooking.event._id,
        { $inc: { availableSeats: targetBooking.numberOfTickets } },
        { session: dbSession },
      )

      await dbSession.commitTransaction()

      const refundMessage =
        refundAmount > 0
          ? `Refund of $${refundAmount.toFixed(2)} will be processed within 3-5 business days`
          : "No refund available due to our cancellation policy"

      return res.status(200).json(
        apiResponse(true, "Booking cancelled successfully", {
          refundAmount,
          message: refundMessage,
        }),
      )
    } catch (transactionError) {
      await dbSession.abortTransaction()
      throw transactionError
    } finally {
      dbSession.endSession()
    }
  } catch (error) {
    console.error("Error cancelling booking:", error)
    return res.status(500).json(apiResponse(false, "Unable to process cancellation"))
  }
}

// Generate QR code for ticket validation
exports.getBookingQRCode = async (req, res) => {
  try {
    const bookingId = req.params.id

    const ticketBooking = await Booking.findById(bookingId).populate("event", "title date time location")
    if (!ticketBooking) {
      return res.status(404).json(apiResponse(false, "Booking not found"))
    }

    // Verify access permissions
    if (req.user.role !== "admin" && ticketBooking.user.toString() !== req.user.userId) {
      return res.status(403).json(apiResponse(false, "Access denied"))
    }

    if (ticketBooking.bookingStatus !== "confirmed") {
      return res.status(400).json(apiResponse(false, "QR codes are only available for confirmed bookings"))
    }

    // Create QR code payload
    const qrCodeData = {
      bookingRef: ticketBooking.bookingReference,
      eventId: ticketBooking.event._id,
      eventName: ticketBooking.event.title,
      eventDate: ticketBooking.event.date,
      ticketCount: ticketBooking.numberOfTickets,
      primaryAttendee: ticketBooking.attendeeInfo[0]?.name || "Guest",
      verificationUrl: `${process.env.CLIENT_URL}/verify-ticket/${ticketBooking.bookingReference}`,
      generatedAt: new Date().toISOString(),
    }

    return res.status(200).json(
      apiResponse(true, "QR code generated successfully", {
        qrData: qrCodeData,
        qrString: JSON.stringify(qrCodeData),
      }),
    )
  } catch (error) {
    console.error("Error generating QR code:", error)
    return res.status(500).json(apiResponse(false, "Unable to generate QR code"))
  }
}

// Generate booking receipt
exports.getBookingReceipt = async (req, res) => {
  try {
    const bookingId = req.params.id

    const receiptBooking = await Booking.findById(bookingId)
      .populate("event", "title date time location price category")
      .populate("user", "name email")

    if (!receiptBooking) {
      return res.status(404).json(apiResponse(false, "Booking not found"))
    }

    // Verify access permissions
    if (req.user.role !== "admin" && receiptBooking.user.toString() !== req.user.userId) {
      return res.status(403).json(apiResponse(false, "Access denied"))
    }

    // Compile receipt information
    const receiptData = {
      bookingReference: receiptBooking.bookingReference,
      issueDate: receiptBooking.bookingDate,
      eventDetails: {
        name: receiptBooking.event.title,
        scheduledDate: receiptBooking.event.date,
        scheduledTime: receiptBooking.event.time,
        venue: receiptBooking.event.location,
        category: receiptBooking.event.category,
      },
      customerDetails: {
        name: receiptBooking.user.name,
        email: receiptBooking.user.email,
      },
      ticketDetails: {
        quantity: receiptBooking.numberOfTickets,
        unitPrice: receiptBooking.event.price,
        totalCost: receiptBooking.totalAmount,
      },
      paymentInfo: {
        method: receiptBooking.paymentMethod,
        status: receiptBooking.paymentStatus,
        transactionId: receiptBooking.paymentTransactionId,
      },
      bookingStatus: receiptBooking.bookingStatus,
      attendeeList: receiptBooking.attendeeInfo,
      specialNotes: receiptBooking.specialRequests,
      generatedAt: new Date().toISOString(),
    }

    return res.status(200).json(apiResponse(true, "Receipt generated successfully", { receipt: receiptData }))
  } catch (error) {
    console.error("Error generating receipt:", error)
    return res.status(500).json(apiResponse(false, "Unable to generate receipt"))
  }
}

// Admin: Get all bookings with filtering
exports.getAllBookings = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid filter parameters", null, errors.array()))
    }

    const {
      page = 1,
      limit = 15,
      status,
      eventId,
      dateFrom,
      dateTo,
      sortBy = "bookingDate",
      sortOrder = "desc",
    } = req.query

    // Build admin query filter
    const adminFilter = {}

    if (status) {
      adminFilter.bookingStatus = status
    }

    if (eventId) {
      adminFilter.event = eventId
    }

    if (dateFrom || dateTo) {
      adminFilter.bookingDate = {}
      if (dateFrom) adminFilter.bookingDate.$gte = new Date(dateFrom)
      if (dateTo) adminFilter.bookingDate.$lte = new Date(dateTo)
    }

    // Configure sorting
    const sortConfig = {}
    sortConfig[sortBy] = sortOrder === "desc" ? -1 : 1

    // Setup pagination
    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skipCount = (pageNum - 1) * limitNum

    const [allBookings, totalCount] = await Promise.all([
      Booking.find(adminFilter)
        .sort(sortConfig)
        .skip(skipCount)
        .limit(limitNum)
        .populate("event", "title date time location price category")
        .populate("user", "name email")
        .lean(),
      Booking.countDocuments(adminFilter),
    ])

    const paginationData = getPaginationMeta(pageNum, limitNum, totalCount)

    return res.status(200).json(
      apiResponse(
        true,
        "All bookings retrieved successfully",
        {
          bookings: allBookings,
          totalCount,
        },
        null,
        paginationData,
      ),
    )
  } catch (error) {
    console.error("Error loading all bookings:", error)
    return res.status(500).json(apiResponse(false, "Unable to load booking data"))
  }
}

// Admin: Get bookings for specific event
exports.getEventBookings = async (req, res) => {
  try {
    const eventId = req.params.eventId
    const { page = 1, limit = 15, status } = req.query

    // Verify event exists
    const targetEvent = await Event.findById(eventId)
    if (!targetEvent) {
      return res.status(404).json(apiResponse(false, "Event not found"))
    }

    // Build filter for event bookings
    const eventFilter = { event: eventId }
    if (status) {
      eventFilter.bookingStatus = status
    }

    // Setup pagination
    const pageNum = Number.parseInt(page)
    const limitNum = Number.parseInt(limit)
    const skipCount = (pageNum - 1) * limitNum

    const [eventBookings, totalEventBookings] = await Promise.all([
      Booking.find(eventFilter)
        .sort({ bookingDate: -1 })
        .skip(skipCount)
        .limit(limitNum)
        .populate("user", "name email")
        .lean(),
      Booking.countDocuments(eventFilter),
    ])

    const paginationData = getPaginationMeta(pageNum, limitNum, totalEventBookings)

    return res.status(200).json(
      apiResponse(
        true,
        "Event bookings retrieved successfully",
        {
          eventInfo: {
            id: targetEvent._id,
            title: targetEvent.title,
            date: targetEvent.date,
            totalSeats: targetEvent.totalSeats,
            availableSeats: targetEvent.availableSeats,
          },
          bookings: eventBookings,
          totalCount: totalEventBookings,
        },
        null,
        paginationData,
      ),
    )
  } catch (error) {
    console.error("Error loading event bookings:", error)
    return res.status(500).json(apiResponse(false, "Unable to load event bookings"))
  }
}

// Admin: Process refund for cancelled booking
exports.refundBooking = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid refund parameters", null, errors.array()))
    }

    const bookingId = req.params.id
    const { refundAmount, reason } = req.body

    const refundBooking = await Booking.findById(bookingId).populate("event")
    if (!refundBooking) {
      return res.status(404).json(apiResponse(false, "Booking not found"))
    }

    if (refundBooking.bookingStatus !== "cancelled") {
      return res.status(400).json(apiResponse(false, "Only cancelled bookings are eligible for refunds"))
    }

    if (refundAmount > refundBooking.totalAmount) {
      return res.status(400).json(apiResponse(false, "Refund amount cannot exceed the original booking total"))
    }

    // Process the refund
    const processedRefund = await Booking.findByIdAndUpdate(
      bookingId,
      {
        refundAmount,
        paymentStatus: refundAmount > 0 ? "refunded" : "paid",
        bookingStatus: "refunded",
        cancellationReason: reason || refundBooking.cancellationReason,
      },
      { new: true },
    )
      .populate("event", "title date")
      .populate("user", "name email")

    return res.status(200).json(
      apiResponse(true, "Refund processed successfully", {
        booking: processedRefund,
        refundAmount,
      }),
    )
  } catch (error) {
    console.error("Error processing refund:", error)
    return res.status(500).json(apiResponse(false, "Unable to process refund"))
  }
}

// Admin: Get comprehensive booking statistics
exports.getBookingStats = async (req, res) => {
  try {
    const currentDate = new Date()

    // Core booking metrics
    const bookingMetrics = await Booking.aggregate([
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
          totalTicketsSold: { $sum: "$numberOfTickets" },
          averageBookingValue: { $avg: "$totalAmount" },
          averageTicketsPerBooking: { $avg: "$numberOfTickets" },
        },
      },
    ])

    // Monthly booking trends
    const monthlyBookingTrends = await Booking.aggregate([
      {
        $match: {
          bookingDate: {
            $gte: new Date(currentDate.getFullYear(), currentDate.getMonth() - 11, 1),
          },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$bookingDate" },
            month: { $month: "$bookingDate" },
          },
          bookingCount: { $sum: 1 },
          monthlyRevenue: {
            $sum: {
              $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0],
            },
          },
          ticketsSold: { $sum: "$numberOfTickets" },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ])

    // Payment method analysis
    const paymentAnalysis = await Booking.aggregate([
      {
        $group: {
          _id: "$paymentMethod",
          usageCount: { $sum: 1 },
          totalValue: { $sum: "$totalAmount" },
        },
      },
      {
        $sort: { usageCount: -1 },
      },
    ])

    // Recent booking activity
    const recentActivity = await Booking.find()
      .sort({ bookingDate: -1 })
      .limit(12)
      .populate("event", "title date")
      .populate("user", "name email")
      .lean()

    return res.status(200).json(
      apiResponse(true, "Booking statistics compiled successfully", {
        overview: bookingMetrics[0] || {
          totalBookings: 0,
          confirmedBookings: 0,
          cancelledBookings: 0,
          refundedBookings: 0,
          totalRevenue: 0,
          totalRefunds: 0,
          totalTicketsSold: 0,
          averageBookingValue: 0,
          averageTicketsPerBooking: 0,
        },
        monthlyTrends: monthlyBookingTrends,
        paymentAnalysis,
        recentActivity,
      }),
    )
  } catch (error) {
    console.error("Error generating booking statistics:", error)
    return res.status(500).json(apiResponse(false, "Unable to generate booking statistics"))
  }
}

module.exports = exports
