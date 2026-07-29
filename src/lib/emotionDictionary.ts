import { EmotionGroup } from '@/types';

export interface EmotionGroupConfig {
  group: EmotionGroup;
  nameKo: string;
  allowedLabels: string[];
  keywords: string[];
}

export const EMOTION_DICTIONARY: Partial<Record<EmotionGroup, EmotionGroupConfig>> = {
  joy: {
    group: 'joy',
    nameKo: '기쁨/행복',
    allowedLabels: [
      '행복', '기쁨', '즐거움', '유쾌함', '설렘', '신남', '재미', '흥미',
      '안도감', '편안함', '희망', '만족', '환희', '뿌듯함', '활기참', '들뜸', '반가움', '기대감'
    ],
    keywords: [
      '행복', '기쁨', '즐거', '유쾌', '설렘', '신남', '신나', '재미', '재밌', '흥미',
      '안도', '편안', '편해', '희망', '만족', '환희', '뿌듯', '활기', '들뜸', '반가움', '기대',
      '좋아', '좋다', '좋아졌', '맛있', '웃기'
    ],
  },
  love: {
    group: 'love',
    nameKo: '사랑/애정',
    allowedLabels: [
      '사랑', '그리움', '보고싶음', '다정함', '따뜻함', '애정', '애착', '배려',
      '고마움', '감동', '친밀함', '아련함', '소중함', '위로받음'
    ],
    keywords: [
      '사랑', '그리움', '그립', '보고싶', '보고 싶', '다정', '따뜻', '애정', '애착', '배려',
      '고마움', '고마워', '감동', '친밀', '아련', '소중', '위로', '너 생각', '생각나', '함께'
    ],
  },
  anger: {
    group: 'anger',
    nameKo: '분노/답답함',
    allowedLabels: [
      '답답함', '속상함', '짜증', '불만', '언짢음', '화남', '서운함', '억울함', '예민함'
    ],
    keywords: [
      '답답', '속상', '짜증', '불만', '언짢', '화남', '화나', '서운', '억울', '예민', '빡치', '열받'
    ],
  },
  disgust: {
    group: 'disgust',
    nameKo: '불쾌/거북함',
    allowedLabels: [
      '불편함', '꺼림칙함', '거북함', '싫음', '불쾌함', '부담스러움'
    ],
    keywords: [
      '불편', '꺼림칙', '거북', '싫음', '싫어', '불쾌', '부담스러', '진상', '시발', '씨발', '개짜증'
    ],
  },
  envy: {
    group: 'envy',
    nameKo: '부러움/아쉬움',
    allowedLabels: [
      '부러움', '아쉬움', '씁쓸함', '탐남', '못마땅함'
    ],
    keywords: [
      '부러움', '부러워', '아쉬움', '아쉬웠', '씁쓸', '탐남', '못마땅'
    ],
  },
  fear: {
    group: 'fear',
    nameKo: '불안/걱정',
    allowedLabels: [
      '불안', '걱정', '초조함', '긴장', '조마조마함', '놀람', '당황함', '부담감'
    ],
    keywords: [
      '불안', '걱정', '초조', '긴장', '조마조마', '놀람', '놀랐', '당황', '부담감'
    ],
  },
  jealousy: {
    group: 'jealousy',
    nameKo: '질투/의심',
    allowedLabels: [
      '질투', '의심', '신경 쓰임', '경계심'
    ],
    keywords: [
      '질투', '의심', '신경 쓰임', '신경쓰여', '경계'
    ],
  },
  sadness: {
    group: 'sadness',
    nameKo: '우울/슬픔',
    allowedLabels: [
      '우울', '슬픔', '외로움', '먹먹함', '실망', '서러움', '낙담', '허전함', '지침', '무기력함'
    ],
    keywords: [
      '우울', '슬픔', '슬펐', '외로움', '외롭', '먹먹', '실망', '서러움', '낙담', '허전',
      '지침', '지쳤', '무기력', '울적', '뭉클', '눈물'
    ],
  },
  shame: {
    group: 'shame',
    nameKo: '부끄러움',
    allowedLabels: [
      '부끄러움', '창피함', '당혹감', '민망함'
    ],
    keywords: [
      '부끄러움', '부끄러', '창피', '당혹', '민망'
    ],
  },
  guilt: {
    group: 'guilt',
    nameKo: '미안함/후회',
    allowedLabels: [
      '미안함', '후회', '안쓰러움'
    ],
    keywords: [
      '미안함', '미안', '후회', '안쓰러'
    ],
  },
  neutral: {
    group: 'neutral',
    nameKo: '평온/담담',
    allowedLabels: [
      '평온함', '담담함', '복잡함', '생각 많음', '무난함'
    ],
    keywords: [
      '평온', '담담', '복잡', '생각 많', '무난', '잔잔'
    ],
  },
};
