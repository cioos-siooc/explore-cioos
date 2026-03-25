-- Add scientific_names column to profiles table for OBIS occurrence data
ALTER TABLE cde.profiles ADD COLUMN IF NOT EXISTS scientific_names text[] DEFAULT '{}';
