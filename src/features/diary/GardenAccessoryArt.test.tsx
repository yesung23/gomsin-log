import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GardenAccessoryArt } from './GardenAccessoryArt';
import {
  SOURCE_ACCESSORY_CROPS,
  isSourceAccessory,
} from './gardenAccessoryCrops';

describe('GardenAccessoryArt source crop rendering', () => {
  it('identifies source accessories and crops correctly', () => {
    expect(isSourceAccessory('boots')).toBe(true);
    expect(isSourceAccessory('sneakers')).toBe(true);
    expect(isSourceAccessory('letter')).toBe(true);
    expect(isSourceAccessory('dogtag')).toBe(true);
    expect(isSourceAccessory('plane')).toBe(true);
    expect(isSourceAccessory('cap')).toBe(false);
    expect(isSourceAccessory('none')).toBe(false);

    expect(SOURCE_ACCESSORY_CROPS.boots.viewBox).toBe('330 506 96 150');
    expect(SOURCE_ACCESSORY_CROPS.sneakers.viewBox).toBe('474 506 92 156');
    expect(SOURCE_ACCESSORY_CROPS.letter.viewBox).toBe('610 542 134 94');
    expect(SOURCE_ACCESSORY_CROPS.dogtag.viewBox).toBe('790 516 72 135');
    expect(SOURCE_ACCESSORY_CROPS.plane.viewBox).toBe('1100 530 108 127');
  });

  it('renders SVG with the paperPairAsset and auto/smooth image-rendering', () => {
    render(<GardenAccessoryArt accessory="boots" testId="test-boots" />);
    const svg = screen.getByTestId('test-boots');
    expect(svg).toHaveAttribute('viewBox', '330 506 96 150');
    const img = svg.querySelector('image');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('width')).toBe('1254');
    expect(img?.getAttribute('height')).toBe('1254');
    expect(img?.style.imageRendering).not.toBe('pixelated');
  });
});
