# Event Booking System API

A comprehensive RESTful API for an Event Booking System built with Node.js, Express, MongoDB, and JWT authentication. This system allows users to browse events, book tickets, and manage their bookings with role-based access control.

## 🚀 Features

### User Management
- User registration and authentication
- JWT-based secure login
- Role-based access control (User/Admin)
- Profile management

### Event Management
- Create, read, update, and delete events (Admin)
- Public event browsing
- Event filtering and search
- Seat availability tracking

### Booking System
- Secure ticket booking
- Booking history and management
- Cancellation with seat restoration
- Duplicate booking prevention

### Security Features
- Password hashing with bcrypt
- JWT token authentication
- Input validation and sanitization
- Rate limiting
- CORS protection

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **Validation**: express-validator
- **Security**: helmet, bcryptjs, express-rate-limit
- **Environment**: dotenv

## 📁 Project Structure

```
server/
├── controllers/
│   ├── authController.js      # Authentication logic
│   ├── eventController.js     # Event management
│   └── bookingController.js   # Booking operations
├── models/
│   ├── User.js               # User schema
│   ├── Event.js              # Event schema
│   └── Booking.js            # Booking schema
├── routes/
│   ├── authRoutes.js         # Authentication routes
│   ├── eventRoutes.js        # Event routes
│   └── bookingRoutes.js      # Booking routes
├── middleware/
│   ├── auth.js               # JWT authentication
│   ├── validation.js         # Input validation
│   └── adminAuth.js          # Admin authorization
├── config/
│   └── database.js           # Database configuration
├── utils/
│   └── helpers.js            # Utility functions
├── .env.example              # Environment variables template
├── server.js                 # Main server file
└── package.json              # Dependencies
```

## 🔧 Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (local or cloud)
- npm or yarn

### Installation Steps

1. **Clone the repository**
```bash
git clone <repository-url>
cd event-booking-system
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment Configuration**
Create a `.env` file in the root directory:
```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/eventbooking

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=7d

# Client URL (for CORS)
CLIENT_URL=http://localhost:3000
```

4. **Start MongoDB**
Make sure MongoDB is running on your system.

5. **Run the application**
```bash
# Development mode
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:5000`

## 📚 API Documentation

### Base URL
```
http://localhost:5000/api
```

### Authentication Endpoints

#### Register User
```http
POST /auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "user"
}
```

#### Login User
```http
POST /auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

#### Get Profile
```http
GET /auth/profile
Authorization: Bearer <jwt_token>
```

### Event Endpoints

#### Get All Events
```http
GET /events?page=1&limit=10&category=conference&search=tech
```

#### Get Event by ID
```http
GET /events/:id
```

#### Create Event (Admin Only)
```http
POST /events
Authorization: Bearer <admin_jwt_token>
Content-Type: application/json

{
  "title": "Tech Conference 2024",
  "description": "Annual technology conference",
  "date": "2024-06-15T09:00:00.000Z",
  "time": "09:00",
  "location": "Convention Center, NYC",
  "totalSeats": 500,
  "price": 99.99,
  "category": "conference"
}
```

#### Update Event (Admin Only)
```http
PUT /events/:id
Authorization: Bearer <admin_jwt_token>
Content-Type: application/json

{
  "title": "Updated Event Title",
  "price": 149.99
}
```

#### Delete Event (Admin Only)
```http
DELETE /events/:id
Authorization: Bearer <admin_jwt_token>
```

### Booking Endpoints

#### Create Booking
```http
POST /bookings
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "eventId": "event_id_here",
  "numberOfTickets": 2
}
```

#### Get User Bookings
```http
GET /bookings/my-bookings?page=1&limit=10&status=confirmed
Authorization: Bearer <jwt_token>
```

#### Get Booking by ID
```http
GET /bookings/:id
Authorization: Bearer <jwt_token>
```

#### Cancel Booking
```http
PUT /bookings/:id/cancel
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "reason": "Unable to attend"
}
```

#### Get All Bookings (Admin Only)
```http
GET /bookings?page=1&limit=10&status=confirmed
Authorization: Bearer <admin_jwt_token>
```

## 🗄️ Database Schema

### User Schema
```javascript
{
  name: String (required, 2-50 chars),
  email: String (required, unique, valid email),
  password: String (required, min 6 chars, hashed),
  role: String (enum: ['user', 'admin'], default: 'user'),
  isActive: Boolean (default: true),
  lastLogin: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### Event Schema
```javascript
{
  title: String (required, 3-100 chars),
  description: String (required, 10-1000 chars),
  date: Date (required, future date),
  time: String (required, HH:MM format),
  location: String (required, 5-200 chars),
  totalSeats: Number (required, 1-100000),
  availableSeats: Number (required, 0-totalSeats),
  price: Number (required, min 0),
  category: String (enum: ['conference', 'workshop', 'concert', 'sports', 'exhibition', 'other']),
  createdBy: ObjectId (ref: User),
  isActive: Boolean (default: true),
  createdAt: Date,
  updatedAt: Date
}
```

### Booking Schema
```javascript
{
  user: ObjectId (ref: User, required),
  event: ObjectId (ref: Event, required),
  numberOfTickets: Number (required, 1-10),
  totalAmount: Number (required, min 0),
  bookingStatus: String (enum: ['confirmed', 'cancelled', 'pending'], default: 'confirmed'),
  bookingReference: String (unique, auto-generated),
  paymentStatus: String (enum: ['paid', 'pending', 'failed', 'refunded'], default: 'pending'),
  bookingDate: Date (default: now),
  cancellationDate: Date,
  cancellationReason: String (max 500 chars),
  createdAt: Date,
  updatedAt: Date
}
```

## 🔒 Security Features

1. **Password Security**: Passwords are hashed using bcrypt with salt rounds
2. **JWT Authentication**: Secure token-based authentication
3. **Input Validation**: All inputs are validated and sanitized
4. **Rate Limiting**: API rate limiting to prevent abuse
5. **CORS Protection**: Cross-origin resource sharing configuration
6. **Helmet**: Security headers for Express applications

## 🧪 Testing

### Manual Testing with Postman/Insomnia

1. **Register a new user**
2. **Login to get JWT token**
3. **Create events (as admin)**
4. **Browse events (public)**
5. **Book tickets (authenticated user)**
6. **View bookings**
7. **Cancel bookings**

### Sample Test Data

#### Admin User
```json
{
  "name": "Admin User",
  "email": "admin@eventbooker.com",
  "password": "admin123",
  "role": "admin"
}
```

#### Regular User
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "user"
}
```

#### Sample Event
```json
{
  "title": "JavaScript Conference 2024",
  "description": "Learn the latest in JavaScript development",
  "date": "2024-08-15T09:00:00.000Z",
  "time": "09:00",
  "location": "Tech Hub, San Francisco",
  "totalSeats": 300,
  "price": 199.99,
  "category": "conference"
}
```

## 🚀 Deployment

### Environment Variables for Production
```env
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/eventbooking
JWT_SECRET=your_production_jwt_secret_key
JWT_EXPIRES_IN=7d
CLIENT_URL=https://your-frontend-domain.com
```

### Docker Deployment (Optional)
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

## 📝 Error Handling

The API uses consistent error response format:

```json
{
  "success": false,
  "message": "Error description",
  "errors": [] // Validation errors if any
}
```

### Common HTTP Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `409`: Conflict
- `500`: Internal Server Error

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

This project is licensed under the MIT License.


