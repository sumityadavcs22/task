// server/controllers/eventController.js
const Event = require("../models/Event")
const Booking = require("../models/Booking")
const { validationResult } = require("express-validator")
const { apiResponse, getPaginationMeta, isValidObjectId, catchAsync } = require("../utils/helpers")

// Get all events with filtering, sorting, and pagination
exports.getAllEvents = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const {
    page = 1,
    limit = 10,
    category,
    location,
    dateFrom,
    dateTo,
    priceMin,
    priceMax,
    sortBy = "date",
    sortOrder = "asc",
    search,
  } = req.query

  // Build filter object
  const filter = {
    isActive: true,
    date: { $gte: new Date() },
  }

  if (category && category !== "all") {
    filter.category = category
  }

  if (location) {
    filter.location = { $regex: location, $options: "i" }
  }

  if (dateFrom || dateTo) {
    if (dateFrom) filter.date.$gte = new Date(dateFrom)
    if (dateTo) filter.date.$lte = new Date(dateTo)
  }

  if (priceMin !== undefined || priceMax !== undefined) {
    filter.price = {}
    if (priceMin !== undefined) filter.price.$gte = Number.parseFloat(priceMin)
    if (priceMax !== undefined) filter.price.$lte = Number.parseFloat(priceMax)
  }

  if (search) {
    filter.$text = { $search: search }
  }

  // Build sort object
  const sort = {}
  sort[sortBy] = sortOrder === "desc" ? -1 : 1

  // Calculate pagination
  const pageNum = Number.parseInt(page)
  const limitNum = Number.parseInt(limit)
  const skip = (pageNum - 1) * limitNum

  // Execute query
  const [events, total] = await Promise.all([
    Event.find(filter).sort(sort).skip(skip).limit(limitNum).populate("createdBy", "name email").lean(),
    Event.countDocuments(filter),
  ])

  // Add virtual fields manually since we're using lean()
  const eventsWithVirtuals = events.map((event) => ({
    ...event,
    bookedSeats: event.totalSeats - event.availableSeats,
    bookingPercentage: Math.round(((event.totalSeats - event.availableSeats) / event.totalSeats) * 100),
    status:
      event.availableSeats === 0
        ? "sold_out"
        : event.availableSeats < event.totalSeats * 0.1
          ? "almost_full"
          : "available",
  }))

  const meta = getPaginationMeta(pageNum, limitNum, total)

  res.status(200).json(
    apiResponse(
      true,
      "Events retrieved successfully",
      {
        events: eventsWithVirtuals,
        total,
      },
      null,
      meta,
    ),
  )
})

// Get event by ID
exports.getEventById = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const { id } = req.params

  const event = await Event.findOne({
    _id: id,
    isActive: true,
  }).populate("createdBy", "name email")

  if (!event) {
    return res.status(404).json(apiResponse(false, "Event not found"))
  }

  // Check if user has booked this event (if authenticated)
  let userBooking = null
  if (req.user) {
    userBooking = await Booking.findOne({
      user: req.user.userId,
      event: id,
      bookingStatus: { $in: ["confirmed", "pending"] },
    })
  }

  res.status(200).json(
    apiResponse(true, "Event retrieved successfully", {
      event,
      userBooking: userBooking ? { id: userBooking._id, status: userBooking.bookingStatus } : null,
    }),
  )
})

// Create new event (Admin only)
exports.createEvent = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const eventData = {
    ...req.body,
    createdBy: req.user.userId,
  }

  // Validate that the date is in the future
  if (new Date(eventData.date) <= new Date()) {
    return res.status(400).json(apiResponse(false, "Event date must be in the future"))
  }

  const event = new Event(eventData)
  await event.save()

  await event.populate("createdBy", "name email")

  res.status(201).json(apiResponse(true, "Event created successfully", { event }))
})

// Update event (Admin only)
exports.updateEvent = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const { id } = req.params

  const event = await Event.findById(id)
  if (!event) {
    return res.status(404).json(apiResponse(false, "Event not found"))
  }

  // Check if there are existing bookings when reducing total seats
  if (req.body.totalSeats && req.body.totalSeats < event.totalSeats) {
    const bookedSeats = event.totalSeats - event.availableSeats
    if (req.body.totalSeats < bookedSeats) {
      return res
        .status(400)
        .json(apiResponse(false, `Cannot reduce total seats below ${bookedSeats} as there are existing bookings`))
    }
    // Update available seats accordingly
    req.body.availableSeats = req.body.totalSeats - bookedSeats
  }

  // Validate date if being updated
  if (req.body.date && new Date(req.body.date) <= new Date()) {
    return res.status(400).json(apiResponse(false, "Event date must be in the future"))
  }

  const updatedEvent = await Event.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  }).populate("createdBy", "name email")

  res.status(200).json(apiResponse(true, "Event updated successfully", { event: updatedEvent }))
})

// Delete event (Admin only)
exports.deleteEvent = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const { id } = req.params

  const event = await Event.findById(id)
  if (!event) {
    return res.status(404).json(apiResponse(false, "Event not found"))
  }

  // Check if there are active bookings
  const activeBookings = await Booking.countDocuments({
    event: id,
    bookingStatus: { $in: ["confirmed", "pending"] },
  })

  if (activeBookings > 0) {
    return res
      .status(400)
      .json(
        apiResponse(
          false,
          `Cannot delete event with ${activeBookings} active bookings. Please cancel all bookings first.`,
        ),
      )
  }

  // Soft delete by setting isActive to false
  await Event.findByIdAndUpdate(id, { isActive: false })

  res.status(200).json(apiResponse(true, "Event deleted successfully"))
})

// Get featured events
exports.getFeaturedEvents = catchAsync(async (req, res) => {
  const events = await Event.find({
    isActive: true,
    isFeatured: true,
    date: { $gte: new Date() },
  })
    .sort({ date: 1 })
    .limit(5)
    .populate("createdBy", "name email")
    .lean()

  const eventsWithVirtuals = events.map((event) => ({
    ...event,
    bookedSeats: event.totalSeats - event.availableSeats,
    bookingPercentage: Math.round(((event.totalSeats - event.availableSeats) / event.totalSeats) * 100),
  }))

  res.status(200).json(apiResponse(true, "Featured events retrieved successfully", { events: eventsWithVirtuals }))
})

// Get upcoming events
exports.getUpcomingEvents = catchAsync(async (req, res) => {
  const { limit = 10 } = req.query

  const events = await Event.find({
    isActive: true,
    date: { $gte: new Date() },
  })
    .sort({ date: 1 })
    .limit(Number.parseInt(limit))
    .populate("createdBy", "name email")
    .lean()

  const eventsWithVirtuals = events.map((event) => ({
    ...event,
    bookedSeats: event.totalSeats - event.availableSeats,
    bookingPercentage: Math.round(((event.totalSeats - event.availableSeats) / event.totalSeats) * 100),
  }))

  res.status(200).json(apiResponse(true, "Upcoming events retrieved successfully", { events: eventsWithVirtuals }))
})

// Get event categories
exports.getCategories = catchAsync(async (req, res) => {
  const categories = [
    { value: "conference", label: "Conference", icon: "🎤" },
    { value: "workshop", label: "Workshop", icon: "🛠️" },
    { value: "concert", label: "Concert", icon: "🎵" },
    { value: "sports", label: "Sports", icon: "⚽" },
    { value: "exhibition", label: "Exhibition", icon: "🎨" },
    { value: "seminar", label: "Seminar", icon: "📚" },
    { value: "networking", label: "Networking", icon: "🤝" },
    { value: "other", label: "Other", icon: "📅" },
  ]

  // Get event counts for each category
  const categoryCounts = await Event.aggregate([
    {
      $match: {
        isActive: true,
        date: { $gte: new Date() },
      },
    },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
      },
    },
  ])

  const countMap = categoryCounts.reduce((acc, item) => {
    acc[item._id] = item.count
    return acc
  }, {})

  const categoriesWithCounts = categories.map((category) => ({
    ...category,
    count: countMap[category.value] || 0,
  }))

  res.status(200).json(apiResponse(true, "Categories retrieved successfully", { categories: categoriesWithCounts }))
})

// Search events
exports.searchEvents = catchAsync(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json(apiResponse(false, "Validation failed", null, errors.array()))
  }

  const { search, page = 1, limit = 10, category, sortBy = "date", sortOrder = "asc" } = req.query

  if (!search) {
    return res.status(400).json(apiResponse(false, "Search query is required"))
  }

  const filter = {
    isActive: true,
    date: { $gte: new Date() },
    $text: { $search: search },
  }

  if (category && category !== "all") {
    filter.category = category
  }

  const sort = { score: { $meta: "textScore" } }
  if (sortBy !== "relevance") {
    sort[sortBy] = sortOrder === "desc" ? -1 : 1
  }

  const pageNum = Number.parseInt(page)
  const limitNum = Number.parseInt(limit)
  const skip = (pageNum - 1) * limitNum

  const [events, total] = await Promise.all([
    Event.find(filter, { score: { $meta: "textScore" } })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .populate("createdBy", "name email")
      .lean(),
    Event.countDocuments(filter),
  ])

  const meta = getPaginationMeta(pageNum, limitNum, total)

  res.status(200).json(
    apiResponse(
      true,
      "Search results retrieved successfully",
      {
        events,
        total,
        searchQuery: search,
      },
      null,
      meta,
    ),
  )
})

// Get events created by current admin
exports.getMyEvents = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, status = "all" } = req.query

  const filter = {
    createdBy: req.user.userId,
  }

  if (status !== "all") {
    filter.isActive = status === "active"
  }

  const pageNum = Number.parseInt(page)
  const limitNum = Number.parseInt(limit)
  const skip = (pageNum - 1) * limitNum

  const [events, total] = await Promise.all([
    Event.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).populate("createdBy", "name email").lean(),
    Event.countDocuments(filter),
  ])

  // Add booking statistics for each event
  const eventsWithStats = await Promise.all(
    events.map(async (event) => {
      const bookingStats = await Booking.aggregate([
        { $match: { event: event._id } },
        {
          $group: {
            _id: "$bookingStatus",
            count: { $sum: 1 },
            totalAmount: { $sum: "$totalAmount" },
            totalTickets: { $sum: "$numberOfTickets" },
          },
        },
      ])

      const stats = bookingStats.reduce(
        (acc, stat) => {
          acc[stat._id] = {
            count: stat.count,
            totalAmount: stat.totalAmount,
            totalTickets: stat.totalTickets,
          }
          acc.total.count += stat.count
          acc.total.totalAmount += stat.totalAmount
          acc.total.totalTickets += stat.totalTickets
          return acc
        },
        { total: { count: 0, totalAmount: 0, totalTickets: 0 } },
      )

      return {
        ...event,
        bookingStats: stats,
        bookedSeats: event.totalSeats - event.availableSeats,
        bookingPercentage: Math.round(((event.totalSeats - event.availableSeats) / event.totalSeats) * 100),
      }
    }),
  )

  const meta = getPaginationMeta(pageNum, limitNum, total)

  res.status(200).json(
    apiResponse(
      true,
      "My events retrieved successfully",
      {
        events: eventsWithStats,
        total,
      },
      null,
      meta,
    ),
  )
})

// Get event statistics (Admin only)
exports.getEventStats = catchAsync(async (req, res) => {
  const now = new Date()

  // Basic event statistics
  const eventStats = await Event.aggregate([
    {
      $group: {
        _id: null,
        totalEvents: { $sum: 1 },
        activeEvents: {
          $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
        },
        upcomingEvents: {
          $sum: {
            $cond: [
              {
                $and: [{ $eq: ["$isActive", true] }, { $gte: ["$date", now] }],
              },
              1,
              0,
            ],
          },
        },
        pastEvents: {
          $sum: {
            $cond: [
              {
                $and: [{ $eq: ["$isActive", true] }, { $lt: ["$date", now] }],
              },
              1,
              0,
            ],
          },
        },
        totalSeats: { $sum: "$totalSeats" },
        totalBookedSeats: {
          $sum: { $subtract: ["$totalSeats", "$availableSeats"] },
        },
        averagePrice: { $avg: "$price" },
        featuredEvents: {
          $sum: { $cond: [{ $eq: ["$isFeatured", true] }, 1, 0] },
        },
      },
    },
  ])

  // Category statistics
  const categoryStats = await Event.aggregate([
    {
      $match: { isActive: true },
    },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        averagePrice: { $avg: "$price" },
        totalSeats: { $sum: "$totalSeats" },
        bookedSeats: {
          $sum: { $subtract: ["$totalSeats", "$availableSeats"] },
        },
      },
    },
    {
      $sort: { count: -1 },
    },
  ])

  // Monthly event creation trend
  const monthlyTrend = await Event.aggregate([
    {
      $match: {
        createdAt: {
          $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1),
        },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        count: { $sum: 1 },
        totalSeats: { $sum: "$totalSeats" },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ])

  // Top events by bookings
  const topEvents = await Event.aggregate([
    {
      $match: {
        isActive: true,
        date: { $gte: now },
      },
    },
    {
      $addFields: {
        bookedSeats: { $subtract: ["$totalSeats", "$availableSeats"] },
        bookingPercentage: {
          $multiply: [{ $divide: [{ $subtract: ["$totalSeats", "$availableSeats"] }, "$totalSeats"] }, 100],
        },
      },
    },
    {
      $sort: { bookedSeats: -1 },
    },
    {
      $limit: 10,
    },
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "creator",
      },
    },
    {
      $project: {
        title: 1,
        date: 1,
        location: 1,
        totalSeats: 1,
        bookedSeats: 1,
        bookingPercentage: 1,
        price: 1,
        category: 1,
        "creator.name": 1,
        "creator.email": 1,
      },
    },
  ])

  res.status(200).json(
    apiResponse(true, "Event statistics retrieved successfully", {
      overview: eventStats[0] || {
        totalEvents: 0,
        activeEvents: 0,
        upcomingEvents: 0,
        pastEvents: 0,
        totalSeats: 0,
        totalBookedSeats: 0,
        averagePrice: 0,
        featuredEvents: 0,
      },
      byCategory: categoryStats,
      monthlyTrend,
      topEvents,
    }),
  )
})

module.exports = exports
