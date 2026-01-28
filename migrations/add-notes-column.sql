-- Add Notes Column Migration
-- Purpose: Add a notes TEXT column to all data tables
-- Date: 2026-01-21
--
-- This migration adds a nullable TEXT column called 'notes' to all main data tables
-- to allow for additional annotations and comments on records.

-- Add notes column to products table
ALTER TABLE products ADD COLUMN notes TEXT;

-- Add notes column to supplement_facts table
ALTER TABLE supplement_facts ADD COLUMN notes TEXT;

-- Add notes column to nutritional_values table
ALTER TABLE nutritional_values ADD COLUMN notes TEXT;

-- Add notes column to ingredients table
ALTER TABLE ingredients ADD COLUMN notes TEXT;

-- Add notes column to dietary_attributes table
ALTER TABLE dietary_attributes ADD COLUMN notes TEXT;

-- Add notes column to processing_log table
ALTER TABLE processing_log ADD COLUMN notes TEXT;
