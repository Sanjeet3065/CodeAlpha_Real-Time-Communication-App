import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LANDING_NAV_LINKS,
  HERO_CONTENT,
  HERO_TRUST_PILLS,
  STUDIO_BENTO_CARDS,
  CARBON_SPOTLIGHT_SPECS,
  FOOTER_POLICY_LINKS,
  countWords,
} from './landingContent.ts';

describe('Homepage Content Contract — Compact 3-Slide Visual Editorial', () => {
  it('1. Keeps header navigation tight with at most 2 valid section anchors', () => {
    assert.ok(LANDING_NAV_LINKS.length >= 1 && LANDING_NAV_LINKS.length <= 2);
    assert.deepStrictEqual(
      LANDING_NAV_LINKS.map((link) => link.href),
      ['#studio', '#trust']
    );
    for (const link of LANDING_NAV_LINKS) {
      assert.ok(countWords(link.label) <= 2, `Nav label "${link.label}" should stay concise`);
    }
  });

  it('2. Excludes instant-meeting and meeting-code copy from Hero configuration', () => {
    const combinedHeroText = [
      HERO_CONTENT.eyebrow,
      HERO_CONTENT.headlineTop,
      HERO_CONTENT.headlineAccent,
      HERO_CONTENT.subtitle,
      HERO_CONTENT.guestPrimaryCta,
      HERO_CONTENT.authPrimaryCta,
      HERO_CONTENT.secondaryCta,
      ...HERO_TRUST_PILLS,
    ]
      .join(' ')
      .toLowerCase();

    assert.ok(!combinedHeroText.includes('start instant meeting'));
    assert.ok(!combinedHeroText.includes('enter code'));
    assert.ok(!combinedHeroText.includes('cly-xxx'));
    assert.strictEqual(HERO_TRUST_PILLS.length, 3);
    assert.ok(countWords(HERO_CONTENT.subtitle) <= 18);
  });

  it('3. Defines exactly 3 visual Bento cards with concise captions (<= 9 words)', () => {
    assert.strictEqual(STUDIO_BENTO_CARDS.length, 3);
    assert.deepStrictEqual(
      STUDIO_BENTO_CARDS.map((card) => card.id),
      ['video-stage', 'vector-canvas', 'room-vault']
    );

    for (const card of STUDIO_BENTO_CARDS) {
      assert.ok(card.title.length > 0 && countWords(card.title) <= 4);
      const captionWords = countWords(card.caption);
      assert.ok(
        captionWords >= 3 && captionWords <= 9,
        `Card "${card.id}" caption "${card.caption}" has ${captionWords} words (expected 3-9)`
      );
    }
  });

  it('4. Keeps Slide 3 spotlight specs crisp and exposes all 3 legal modal topics', () => {
    assert.strictEqual(CARBON_SPOTLIGHT_SPECS.length, 3);
    for (const spec of CARBON_SPOTLIGHT_SPECS) {
      assert.ok(countWords(spec) <= 5);
    }

    assert.deepStrictEqual(
      FOOTER_POLICY_LINKS.map((item) => item.topic),
      ['Privacy', 'Terms', 'Security']
    );
  });

  it('5. Enforces compact 3-slide wiring across LandingPage, NavBar, HeroSection, FeatureGrid, and ConversionBanner', () => {
    const landingDir = import.meta.dirname;
    const heroSource = fs.readFileSync(path.join(landingDir, 'HeroSection.tsx'), 'utf8');
    const navSource = fs.readFileSync(path.join(landingDir, 'NavBar.tsx'), 'utf8');
    const gridSource = fs.readFileSync(path.join(landingDir, 'FeatureGrid.tsx'), 'utf8');
    const bannerSource = fs.readFileSync(path.join(landingDir, 'ConversionBanner.tsx'), 'utf8');
    const pageSource = fs.readFileSync(path.resolve(landingDir, '../../pages/LandingPage.tsx'), 'utf8');

    assert.ok(!heroSource.includes('Start Instant Meeting'));
    assert.ok(!heroSource.includes('Enter code'));
    assert.ok(!heroSource.includes('handleJoinSubmit'));
    assert.ok(heroSource.includes('hero-studio.jpg'));
    assert.ok(!heroSource.includes('design-review'));
    assert.ok(!heroSource.includes('Riya Kapoor'));
    assert.ok(gridSource.includes('id="studio"'));
    assert.ok(bannerSource.includes('id="trust"'));
    assert.ok(navSource.includes('#studio') && navSource.includes('#trust'));
    assert.ok(!navSource.includes('#how-it-works') && !navSource.includes('#architecture'));
    assert.ok(!pageSource.includes('ArchitectureSpotlight'));
    assert.ok(!pageSource.includes('HowItWorksSection'));
    assert.ok(!pageSource.includes('SecurityTrustSection'));
    assert.ok(!fs.existsSync(path.join(landingDir, 'ArchitectureSpotlight.tsx')));
    assert.ok(!fs.existsSync(path.join(landingDir, 'HowItWorksSection.tsx')));
    assert.ok(!fs.existsSync(path.join(landingDir, 'SecurityTrustSection.tsx')));
  });
});
