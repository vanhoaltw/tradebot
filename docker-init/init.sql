-- Create role without password - allow connections without password
CREATE ROLE tradebot WITH LOGIN CREATEDB SUPERUSER PASSWORD 'tradebot';

-- Create database
CREATE DATABASE tradebot OWNER tradebot;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE tradebot TO tradebot;
