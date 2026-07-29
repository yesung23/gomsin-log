import { EmotionAnalysis } from '@/types';
import { recommendEmotionFlow } from './emotionRuleEngine';

/**
 * Pure Adapter for Emotion Flow Analysis using local rule engine.
 * External AI API calls (OpenAI, Gemini, Anthropic) are explicitly disabled
 * according to product specification: "Rule-based recommendation + User direct confirmation".
 */
export async function analyzeEmotionWithAI(params: {
  logText: string;
  mediaDescription?: string;
  recordedAt?: string;
}): Promise<EmotionAnalysis> {
  return analyzeEmotionFallback(params.logText, params.mediaDescription);
}

/**
 * Local Rule Engine Adapter producing EmotionAnalysis structure.
 */
export function analyzeEmotionFallback(logText: string, mediaDescription?: string): EmotionAnalysis {
  const flowItems = recommendEmotionFlow(logText, mediaDescription);

  if (flowItems.length === 0) {
    return {
      primaryEmotion: 'uncertain',
      confidence: 0.3,
      flowList: [],
      emotionPath: '',
      emotionSummary: '',
    };
  }

  const emotionPath = flowItems.map((f) => f.displayLabel).join(' → ');
  const primaryEmotion = flowItems[flowItems.length - 1].group;

  return {
    primaryEmotion,
    confidence: 0.85,
    flowList: flowItems,
    emotionPath,
    emotionSummary: emotionPath,
  };
}
