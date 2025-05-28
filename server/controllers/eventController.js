// server/controllers/eventController.js
const Event = require("../models/Event")
const Booking = require("../models/Booking")
const { validationResult } = require("express-validator")
const { apiResponse, getPaginationMeta, isValidObjectId } = require("../utils/helpers")

// Get all events - main listing endpoint
exports.getAllEvents = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid request parameters", null, errors.array()))
    }

    const {
      page = 1,
      limit = 12,
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

    // Build query filters
    let queryFilter = {
      isActive: true,
      date: { $gte: new Date() },
    }

    // Category filtering
    if (category && category !== "all") {
      queryFilter.category = category
    }

    // Location search - case insensitive
    if (location) {
      queryFilter.location = { $regex: new RegExp(location, "i") }
    }

    // Date range filtering
    if (dateFrom || dateTo) {
      if (dateFrom) queryFilter.date.$gte = new Date(dateFrom)
      if (dateTo) queryFilter.date.$lte = new Date(dateTo)
    }

    // Price range filtering
    if (priceMin !== undefined || priceMax !== undefined) {
      queryFilter.price = {}
      if (priceMin !== undefined) queryFilter.price.$gte = parseFloat(priceMin)
      if (priceMax !== undefined) queryFilter.price.$lte = parseFloat(priceMax)
    }

    // Text search across multiple fields
    if (search) {
      queryFilter.$text = { $search: search }
    }

    // Sorting configuration
    let sortConfig = {}
    sortConfig[sortBy] = sortOrder === "desc" ? -1 : 1

    // Pagination setup
    const pageNumber = parseInt(page)
    const limitNumber = parseInt(limit)
    const skipCount = (pageNumber - 1) * limitNumber

    // Execute queries in parallel for better performance
    const [eventsList, totalCount] = await Promise.all([
      Event.find(queryFilter)
        .sort(sortConfig)
        .skip(skipCount)
        .limit(limitNumber)
        .populate("createdBy", "name email")
        .lean(),
      Event.countDocuments(queryFilter),
    ])

    // Calculate additional fields for each event
    const enrichedEvents = eventsList.map((event) => {
      const soldTickets = event.totalSeats - event.availableSeats
      const occupancyRate = Math.round((soldTickets / event.totalSeats) * 100)
      
      let eventStatus = "available"
      if (event.availableSeats === 0) {
        eventStatus = "sold_out"
      } else if (event.availableSeats < event.totalSeats * 0.15) {
        eventStatus = "filling_fast"
      }

      return {
        ...event,
        soldTickets,
        occupancyRate,
        eventStatus,
      }
    })

    const paginationMeta = getPaginationMeta(pageNumber, limitNumber, totalCount)

    return res.status(200).json(
      apiResponse(
        true,
        "Events loaded successfully",
        {
          events: enrichedEvents,
          totalEvents: totalCount,
        },
        null,
        paginationMeta,
      ),
    )
  } catch (error) {
    console.error("Error in getAllEvents:", error)
    return res.status(500).json(apiResponse(false, "Failed to load events"))
  }
}

// Get single event details
exports.getEventById = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid event ID format", null, errors.array()))
    }

    const eventId = req.params.id

    const eventDetails = await Event.findOne({
      _id: eventId,
      isActive: true,
    }).populate("createdBy", "name email")

    if (!eventDetails) {
      return res.status(404).json(apiResponse(false, "Event not found or no longer available"))
    }

    // Check if current user has existing booking
    let existingBooking = null
    if (req.user) {
      existingBooking = await Booking.findOne({
        user: req.user.userId,
        event: eventId,
        bookingStatus: { $in: ["confirmed", "pending"] },
      })
    }

    // Calculate event metrics
    const soldTickets = eventDetails.totalSeats - eventDetails.availableSeats
    const occupancyRate = Math.round((soldTickets / eventDetails.totalSeats) * 100)
    
    // Determine event urgency
    const eventDate = new Date(eventDetails.date)
    const currentDate = new Date()
    const daysUntilEvent = Math.ceil((eventDate - currentDate) / (1000 * 60 * 60 * 24))
    
    let urgencyLevel = "normal"
    if (daysUntilEvent <= 3) urgencyLevel = "urgent"
    else if (daysUntilEvent <= 7) urgencyLevel = "soon"

    const responseData = {
      event: {
        ...eventDetails.toObject(),
        soldTickets,
        occupancyRate,
        daysUntilEvent,
        urgencyLevel,
      },
      userBooking: existingBooking ? { 
        id: existingBooking._id, 
        status: existingBooking.bookingStatus,
        ticketCount: existingBooking.numberOfTickets 
      } : null,
    }

    return res.status(200).json(apiResponse(true, "Event details retrieved", responseData))
  } catch (error) {
    console.error("Error in getEventById:", error)
    return res.status(500).json(apiResponse(false, "Unable to load event details"))
  }
}

// Create new event - admin functionality
exports.createEvent = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Please check your input data", null, errors.array()))
    }

    const eventInfo = {
      ...req.body,
      createdBy: req.user.userId,
    }

    // Business rule: events must be scheduled at least 24 hours in advance
    const eventDateTime = new Date(eventInfo.date)
    const minimumNotice = new Date()
    minimumNotice.setHours(minimumNotice.getHours() + 24)

    if (eventDateTime <= minimumNotice) {
      return res.status(400).json(apiResponse(false, "Events must be scheduled at least 24 hours in advance"))
    }

    // Create the event
    const newEvent = new Event(eventInfo)
    await newEvent.save()

    // Populate creator information
    await newEvent.populate("createdBy", "name email")

    return res.status(201).json(apiResponse(true, "Event created successfully", { event: newEvent }))
  } catch (error) {
    console.error("Error creating event:", error)
    
    // Handle specific validation errors
    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }))
      return res.status(400).json(apiResponse(false, "Event validation failed", null, validationErrors))
    }

    return res.status(500).json(apiResponse(false, "Failed to create event"))
  }
}

// Update existing event
exports.updateEvent = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid update data", null, errors.array()))
    }

    const eventId = req.params.id

    const existingEvent = await Event.findById(eventId)
    if (!existingEvent) {
      return res.status(404).json(apiResponse(false, "Event not found"))
    }

    // Business logic: prevent reducing seats below current bookings
    if (req.body.totalSeats && req.body.totalSeats < existingEvent.totalSeats) {
      const currentBookings = existingEvent.totalSeats - existingEvent.availableSeats
      if (req.body.totalSeats < currentBookings) {
        return res
          .status(400)
          .json(
            apiResponse(
              false,
              `Cannot reduce capacity below ${currentBookings} - there are existing bookings`,
            ),
          )
      }
      // Adjust available seats proportionally
      req.body.availableSeats = req.body.totalSeats - currentBookings
    }

    // Validate future date if being updated
    if (req.body.date) {
      const newEventDate = new Date(req.body.date)
      const currentTime = new Date()
      if (newEventDate <= currentTime) {
        return res.status(400).json(apiResponse(false, "Event date must be in the future"))
      }
    }

    const updatedEvent = await Event.findByIdAndUpdate(eventId, req.body, {
      new: true,
      runValidators: true,
    }).populate("createdBy", "name email")

    return res.status(200).json(apiResponse(true, "Event updated successfully", { event: updatedEvent }))
  } catch (error) {
    console.error("Error updating event:", error)
    return res.status(500).json(apiResponse(false, "Failed to update event"))
  }
}

// Remove event (soft delete)
exports.deleteEvent = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Invalid event ID", null, errors.array()))
    }

    const eventId = req.params.id

    const targetEvent = await Event.findById(eventId)
    if (!targetEvent) {
      return res.status(404).json(apiResponse(false, "Event not found"))
    }

    // Check for active bookings before deletion
    const activeBookingCount = await Booking.countDocuments({
      event: eventId,
      bookingStatus: { $in: ["confirmed", "pending"] },
    })

    if (activeBookingCount > 0) {
      return res
        .status(400)
        .json(
          apiResponse(
            false,
            `Cannot delete event - ${activeBookingCount} active bookings exist. Please handle bookings first.`,
          ),
        )
    }

    // Perform soft delete
    await Event.findByIdAndUpdate(eventId, { isActive: false })

    return res.status(200).json(apiResponse(true, "Event removed successfully"))
  } catch (error) {
    console.error("Error deleting event:", error)
    return res.status(500).json(apiResponse(false, "Failed to remove event"))
  }
}

// Get featured events for homepage
exports.getFeaturedEvents = async (req, res) => {
  try {
    const featuredEventsList = await Event.find({
      isActive: true,
      isFeatured: true,
      date: { $gte: new Date() },
    })
      .sort({ date: 1 })
      .limit(6)
      .populate("createdBy", "name email")
      .lean()

    const processedEvents = featuredEventsList.map((event) => {
      const ticketsSold = event.totalSeats - event.availableSeats
      const popularityScore = Math.round((ticketsSold / event.totalSeats) * 100)

      return {
        ...event,
        ticketsSold,
        popularityScore,
      }
    })

    return res.status(200).json(apiResponse(true, "Featured events loaded", { events: processedEvents }))
  } catch (error) {
    console.error("Error loading featured events:", error)
    return res.status(500).json(apiResponse(false, "Unable to load featured events"))
  }
}

// Get upcoming events
exports.getUpcomingEvents = async (req, res) => {
  try {
    const { limit = 8 } = req.query

    const upcomingEventsList = await Event.find({
      isActive: true,
      date: { $gte: new Date() },
    })
      .sort({ date: 1 })
      .limit(parseInt(limit))
      .populate("createdBy", "name email")
      .lean()

    const eventsWithMetrics = upcomingEventsList.map((event) => {
      const reservedSeats = event.totalSeats - event.availableSeats
      const bookingRate = Math.round((reservedSeats / event.totalSeats) * 100)

      return {
        ...event,
        reservedSeats,
        bookingRate,
      }
    })

    return res.status(200).json(apiResponse(true, "Upcoming events retrieved", { events: eventsWithMetrics }))
  } catch (error) {
    console.error("Error loading upcoming events:", error)
    return res.status(500).json(apiResponse(false, "Failed to load upcoming events"))
  }
}

// Get available categories
exports.getCategories = async (req, res) => {
  try {
    const categoryList = [
      { value: "conference", label: "Conference", icon: "🎤", description: "Professional conferences and summits" },
      { value: "workshop", label: "Workshop", icon: "🛠️", description: "Hands-on learning sessions" },
      { value: "concert", label: "Concert", icon: "🎵", description: "Live music performances" },
      { value: "sports", label: "Sports", icon: "⚽", description: "Sporting events and competitions" },
      { value: "exhibition", label: "Exhibition", icon: "🎨", description: "Art shows and exhibitions" },
      { value: "seminar", label: "Seminar", icon: "📚", description: "Educational seminars" },
      { value: "networking", label: "Networking", icon: "🤝", description: "Professional networking events" },
      { value: "other", label: "Other", icon: "📅", description: "Miscellaneous events" },
    ]

    // Get actual event counts per category
    const categoryMetrics = await Event.aggregate([
      {
        $match: {
          isActive: true,
          date: { $gte: new Date() },
        },
      },
      {
        $group: {
          _id: "$category",
          eventCount: { $sum: 1 },
          avgPrice: { $avg: "$price" },
        },
      },
    ])

    const metricsMap = categoryMetrics.reduce((acc, item) => {
      acc[item._id] = {
        count: item.eventCount,
        averagePrice: Math.round(item.avgPrice || 0),
      }
      return acc
    }, {})

    const enrichedCategories = categoryList.map((category) => ({
      ...category,
      eventCount: metricsMap[category.value]?.count || 0,
      averagePrice: metricsMap[category.value]?.averagePrice || 0,
    }))

    return res.status(200).json(apiResponse(true, "Categories loaded successfully", { categories: enrichedCategories }))
  } catch (error) {
    console.error("Error loading categories:", error)
    return res.status(500).json(apiResponse(false, "Failed to load categories"))
  }
}

// Search events with text query
exports.searchEvents = async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json(apiResponse(false, "Search parameters invalid", null, errors.array()))
    }

    const { search, page = 1, limit = 10, category, sortBy = "relevance", sortOrder = "desc" } = req.query

    if (!search || search.trim().length < 2) {
      return res.status(400).json(apiResponse(false, "Search query must be at least 2 characters"))
    }

    const searchFilter = {
      isActive: true,
      date: { $gte: new Date() },
      $text: { $search: search.trim() },
    }

    if (category && category !== "all") {
      searchFilter.category = category
    }

    let sortConfiguration = { score: { $meta: "textScore" } }
    if (sortBy !== "relevance") {
      sortConfiguration[sortBy] = sortOrder === "desc" ? -1 : 1
    }

    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skipAmount = (pageNum - 1) * limitNum

    const [searchResults, totalMatches] = await Promise.all([
      Event.find(searchFilter, { score: { $meta: "textScore" } })
        .sort(sortConfiguration)
        .skip(skipAmount)
        .limit(limitNum)
        .populate("createdBy", "name email")
        .lean(),
      Event.countDocuments(searchFilter),
    ])

    const paginationInfo = getPaginationMeta(pageNum, limitNum, totalMatches)

    return res.status(200).json(
      apiResponse(
        true,
        "Search completed successfully",
        {
          results: searchResults,
          totalMatches,
          searchTerm: search.trim(),
        },
        null,
        paginationInfo,
      ),
    )
  } catch (error) {
    console.error("Error in search:", error)
    return res.status(500).json(apiResponse(false, "Search functionality unavailable"))
  }
}

// Get admin's created events
exports.getMyEvents = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = "all" } = req.query

    const eventFilter = {
      createdBy: req.user.userId,
    }

    if (status !== "all") {
      eventFilter.isActive = status === "active"
    }

    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skipAmount = (pageNum - 1) * limitNum

    const [myEventsList, totalMyEvents] = await Promise.all([
      Event.find(eventFilter)
        .sort({ createdAt: -1 })
        .skip(skipAmount)
        .limit(limitNum)
        .populate("createdBy", "name email")
        .lean(),
      Event.countDocuments(eventFilter),
    ])

    // Add booking analytics for each event
    const eventsWithAnalytics = await Promise.all(
      myEventsList.map(async (event) => {
        const bookingAnalytics = await Booking.aggregate([
          { $match: { event: event._id } },
          {
            $group: {
              _id: "$bookingStatus",
              count: { $sum: 1 },
              revenue: { $sum: "$totalAmount" },
              tickets: { $sum: "$numberOfTickets" },
            },
          },
        ])

        const analytics = bookingAnalytics.reduce(
          (summary, booking) => {
            summary[booking._id] = {
              count: booking.count,
              revenue: booking.revenue,
              tickets: booking.tickets,
            }
            summary.totals.count += booking.count
            summary.totals.revenue += booking.revenue
            summary.totals.tickets += booking.tickets
            return summary
          },
          { totals: { count: 0, revenue: 0, tickets: 0 } },
        )

        const soldSeats = event.totalSeats - event.availableSeats
        const fillRate = Math.round((soldSeats / event.totalSeats) * 100)

        return {
          ...event,
          analytics,
          soldSeats,
          fillRate,
        }
      }),
    )

    const paginationData = getPaginationMeta(pageNum, limitNum, totalMyEvents)

    return res.status(200).json(
      apiResponse(
        true,
        "Your events loaded successfully",
        {
          events: eventsWithAnalytics,
          total: totalMyEvents,
        },
        null,
        paginationData,
      ),
    )
  } catch (error) {
    console.error("Error loading my events:", error)
    return res.status(500).json(apiResponse(false, "Unable to load your events"))
  }
}

// Get comprehensive event statistics
exports.getEventStats = async (req, res) => {
  try {
    const currentDate = new Date()

    // Core event metrics
    const coreMetrics = await Event.aggregate([
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
                  $and: [{ $eq: ["$isActive", true] }, { $gte: ["$date", currentDate] }],
                },
                1,
                0,
              ],
            },
          },
          completedEvents: {
            $sum: {
              $cond: [
                {
                  $and: [{ $eq: ["$isActive", true] }, { $lt: ["$date", currentDate] }],
                },
                1,
                0,
              ],
            },
          },
          totalCapacity: { $sum: "$totalSeats" },
          totalBooked: {
            $sum: { $subtract: ["$totalSeats", "$availableSeats"] },
          },
          averageTicketPrice: { $avg: "$price" },
          featuredCount: {
            $sum: { $cond: [{ $eq: ["$isFeatured", true] }, 1, 0] },
          },
        },
      },
    ])

    // Category breakdown
    const categoryBreakdown = await Event.aggregate([
      {
        $match: { isActive: true },
      },
      {
        $group: {
          _id: "$category",
          eventCount: { $sum: 1 },
          avgTicketPrice: { $avg: "$price" },
          totalCapacity: { $sum: "$totalSeats" },
          totalBooked: {
            $sum: { $subtract: ["$totalSeats", "$availableSeats"] },
          },
        },
      },
      {
        $sort: { eventCount: -1 },
      },
    ])

    // Monthly creation trends
    const creationTrends = await Event.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(currentDate.getFullYear(), currentDate.getMonth() - 11, 1),
          },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          eventsCreated: { $sum: 1 },
          totalCapacity: { $sum: "$totalSeats" },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ])

    // Popular events ranking
    const popularEvents = await Event.aggregate([
      {
        $match: {
          isActive: true,
          date: { $gte: currentDate },
        },
      },
      {
        $addFields: {
          ticketsSold: { $subtract: ["$totalSeats", "$availableSeats"] },
          salesRate: {
            $multiply: [{ $divide: [{ $subtract: ["$totalSeats", "$availableSeats"] }, "$totalSeats"] }, 100],
          },
        },
      },
      {
        $sort: { ticketsSold: -1 },
      },
      {
        $limit: 10,
      },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "organizer",
        },
      },
      {
        $project: {
          title: 1,
          date: 1,
          location: 1,
          totalSeats: 1,
          ticketsSold: 1,
          salesRate: 1,
          price: 1,
          category: 1,
          "organizer.name": 1,
          "organizer.email": 1,
        },
      },
    ])

    return res.status(200).json(
      apiResponse(true, "Event statistics compiled successfully", {
        summary: coreMetrics[0] || {
          totalEvents: 0,
          activeEvents: 0,
          upcomingEvents: 0,
          completedEvents: 0,
          totalCapacity: 0,
          totalBooked: 0,
          averageTicketPrice: 0,
          featuredCount: 0,
        },
        categoryBreakdown,
        creationTrends,
        popularEvents,
      }),
    )
  } catch (error) {
    console.error("Error generating event statistics:", error)
    return res.status(500).json(apiResponse(false, "Unable to generate statistics"))
  }
}

module.exports = exports
