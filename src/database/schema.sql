-- Database setup for Dictum Legal Bot
-- Run this in pgAdmin to create all necessary tables

-- Create database (run this first if database doesn't exist)
-- CREATE DATABASE dictum_legal_bot;

-- Connect to dictum_legal_bot database, then run the following:

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    first_name VARCHAR(255),
    blocked BOOLEAN DEFAULT FALSE,
    blocked_at TIMESTAMP,
    blocked_by INTEGER,
    block_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Admins table
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('master', 'student')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Requests table
CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(255) NOT NULL,
    request_text TEXT NOT NULL,
    request_type VARCHAR(50) DEFAULT 'text',
    file_id VARCHAR(255),
    file_size INTEGER,
    file_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'student_responded', 'answered', 'rejected')),
    response_text TEXT,
    student_response TEXT,
    responded_by VARCHAR(255),
    student_admin_id INTEGER REFERENCES admins(id),
    master_approved BOOLEAN DEFAULT FALSE,
    assigned_to INTEGER REFERENCES admins(id),
    assigned_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    answered_at TIMESTAMP
);

-- Block history table
CREATE TABLE IF NOT EXISTS block_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL CHECK (action IN ('blocked', 'unblocked')),
    reason TEXT,
    performed_by INTEGER REFERENCES admins(id),
    performed_at TIMESTAMP DEFAULT NOW()
);

-- Insert default master admin
INSERT INTO admins (username, password, full_name, role)
VALUES ('admin', 'dictum2026', 'Master Admin', 'master')
ON CONFLICT (username) DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_requests_user_id ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_assigned_to ON requests(assigned_to);

-- Success message
SELECT 'Database schema created successfully!' as message;
