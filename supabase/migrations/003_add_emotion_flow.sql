-- Add emotion_flow and emotion_updated_at columns to daily_records table
ALTER TABLE public.daily_records 
ADD COLUMN IF NOT EXISTS emotion_flow JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS emotion_updated_at TIMESTAMPTZ;
