import { expect, test } from '@playwright/test';

async function preparePage(page) {
  const consoleErrors = [];
  const transparentTile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.route('https://*.basemaps.cartocdn.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: transparentTile
  }));
  return consoleErrors;
}

test('demo journey chooses a starter RAPPID, evolves it, and grows parallel offspring', async ({ page }) => {
  const consoleErrors = await preparePage(page);
  await page.goto('/?demo=1&reset=1');

  await expect(page.getByRole('heading', { name: /Welcome to RaGo. Meet the RAPPIDs/i })).toBeVisible();
  await expect(page.getByText('Identity stays', { exact: true })).toBeVisible();
  await expect(page.getByText('Frames remember', { exact: true })).toBeVisible();
  await expect(page.getByText('Offspring branch', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enter the demo field' }).click();
  await expect(page.getByRole('heading', { name: /What should your starter RAPPID begin by remembering/i })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal three starter RAPPIDs' }).click();
  await expect(page.getByRole('heading', { name: /Choose your starter RAPPID/i })).toBeVisible();
  await page.getByRole('button', { name: /^Choose .* as my starter/ }).first().click();

  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#weather-pill')).toContainText('19°');
  await expect(page.getByRole('heading', { name: 'Moments nearby', exact: true })).toBeVisible();
  const mapWorld = await page.evaluate(() => ({
    webgl: Boolean(document.querySelector('#world-map').getContext('webgl2')),
    creatureRigs: [...window.__RAPP_GO__.map.markerObjects.values()].filter((object) => object.userData.marker.type === 'creature').length,
    groundTiles: window.__RAPP_GO__.map.tileMeshes.filter((mesh) => mesh.userData.tile).length,
    cameraHeight: window.__RAPP_GO__.map.camera.position.y,
    cameraDistance: window.__RAPP_GO__.map.camera.position.z
  }));
  expect(mapWorld.webgl).toBe(true);
  expect(mapWorld.creatureRigs).toBeGreaterThanOrEqual(7);
  expect(mapWorld.groundTiles).toBeGreaterThanOrEqual(20);
  expect(mapWorld.cameraHeight).toBeLessThan(mapWorld.cameraDistance);

  await page.getByRole('button', { name: /Visit Cedar Street Fountain/i }).click();
  await expect(page.getByRole('heading', { name: 'Cedar Street Fountain' })).toBeVisible();
  await page.getByRole('button', { name: 'Gather from this place' }).click();
  await expect(page.locator('#drop-list .drop-chip').first()).toBeVisible();
  await expect(page.locator('#place-note')).toContainText(/gives|full/i);
  await page.getByRole('button', { name: 'Close place' }).click();

  const founding = await page.evaluate(() => ({
    genome: window.__RAGO__.state.companion.frames.at(-1).payload.creature.id,
    rappid: window.__RAGO__.state.companion.rappid,
    frame: window.__RAGO__.state.companion.head
  }));
  await page.getByRole('button', { name: /Capture/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Capture this moment' })).toBeVisible();
  await page.getByLabel('Name this memory').fill('the laugh on the platform');
  await page.getByLabel('A thought here').fill('I want to remember how the whole station became warm');
  await page.getByRole('button', { name: 'Let the moment take form' }).click();
  await expect(page.locator('#encounter-dialog')).toHaveAttribute('data-catch-state', 'ready');
  await page.getByRole('button', { name: /Throw when the ring is small/i }).click();
  await expect(page.locator('#encounter-dialog')).toHaveAttribute('data-catch-state', 'caught');
  await expect(page.locator('#encounter-result')).toContainText('Caught');
  await page.getByRole('button', { name: 'Splice into selected RAPPID' }).click();

  await expect(page.getByRole('heading', { name: /Splice .* into your selected RAPPID/i })).toBeVisible();
  await page.locator('#splice-dialog input[name="splice-trait"][value="form"]').check();
  await page.locator('#splice-dialog input[name="splice-trait"][value="motion"]').check();
  await page.getByRole('button', { name: 'Absorb selected traits' }).click();

  await expect(page.getByRole('heading', { name: 'Your RAPPID' })).toBeVisible();
  await expect(page.locator('#companion-generation')).toContainText('generation 0 · frame 1');
  await expect(page.locator('#companion-frame-count')).toHaveText('2');
  const evolved = await page.evaluate(() => ({
    genome: window.__RAGO__.state.companion.frames.at(-1).payload.creature.id,
    rappid: window.__RAGO__.state.companion.rappid,
    frame: window.__RAGO__.state.companion.head
  }));
  expect(evolved.genome).not.toBe(founding.genome);
  expect(evolved.rappid).toBe(founding.rappid);
  expect(evolved.frame).not.toBe(founding.frame);
  expect(await page.locator('#companion-creature').evaluate((canvas) => Boolean(canvas.getContext('webgl2')))).toBe(true);

  await page.getByRole('button', { name: /Lineage 1/i }).click();
  await expect(page.getByRole('heading', { name: 'Your RAPPID lineage' })).toBeVisible();
  await page.getByRole('button', { name: 'Drill from selected head' }).click();
  await expect(page.locator('.rappid-card')).toHaveCount(4);
  await expect(page.locator('.lineage-generation')).toHaveCount(2);
  const lineage = await page.evaluate(() => ({
    count: window.__RAGO__.state.lineage.organisms.length,
    generations: [...new Set(window.__RAGO__.state.lineage.organisms.map((organism) => organism.generation))],
    selected: window.__RAGO__.state.companion.rappid,
    parent: window.__RAGO__.state.companion.parent.rappid
  }));
  expect(lineage.count).toBe(4);
  expect(lineage.generations).toEqual([0, 1]);
  expect(lineage.selected).not.toBe(founding.rappid);
  expect(lineage.parent).toBe(founding.rappid);

  await page.getByRole('button', { name: /RAPPID 1/i }).click();
  await page.getByRole('button', { name: 'Freeze at latest head' }).click();
  await expect(page.getByRole('button', { name: 'Wake from latest head' })).toBeVisible();
  expect(await page.evaluate(() => window.__RAGO__.state.companion.status)).toBe('frozen');
  await page.getByRole('button', { name: 'Wake from latest head' }).click();
  await expect(page.getByRole('button', { name: 'Freeze at latest head' })).toBeVisible();
  expect(await page.evaluate(() => window.__RAGO__.state.companion.status)).toBe('awake');

  await page.getByRole('button', { name: /Caught 2/i }).click();

  await expect(page.getByRole('heading', { name: 'Captured RAPPIDs' })).toBeVisible();
  await expect(page.locator('.collection-card')).toHaveCount(2);
  await page.locator('.collection-card').last().getByRole('button', { name: /Share/i }).click();
  await expect(page.locator('#share-url')).toHaveValue(/#creature=/u);
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  await page.getByRole('button', { name: 'Close share dialog' }).click();

  const themeButton = page.getByRole('button', { name: 'Switch to dark theme' });
  await themeButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('live permission flow coarse-grains weather and place requests', async ({ page, context }) => {
  const consoleErrors = await preparePage(page);
  const weatherRequests = [];
  const placeRequests = [];
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  await context.setGeolocation({ latitude: 33.7490123, longitude: -84.3879824, accuracy: 9 });
  await page.route('https://api.open-meteo.com/**', async (route) => {
    weatherRequests.push(route.request().url());
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ current: { temperature_2m: 24, weather_code: 0, wind_speed_10m: 4, is_day: 1 } })
    });
  });
  await page.route('https://overpass-api.de/**', async (route) => {
    placeRequests.push(route.request().postData() || '');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        elements: [{ type: 'node', id: 99, lat: 33.7492, lon: -84.388, tags: { amenity: 'fountain', name: 'Atlanta Test Fountain' } }]
      })
    });
  });

  await page.goto('/?reset=1');
  await page.getByRole('button', { name: 'Enter my local field' }).click();
  await expect(page.getByRole('heading', { name: /What should your starter RAPPID begin by remembering/i })).toBeVisible();
  await page.getByLabel('A thought, phrase, or person').fill('the first warm morning after a long winter');
  await page.getByRole('button', { name: 'Reveal three starter RAPPIDs' }).click();
  await expect(page.getByRole('heading', { name: /Choose your starter RAPPID/i })).toBeVisible();
  await page.getByRole('button', { name: /^Choose .* as my starter/ }).first().click();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  await expect(page.locator('#weather-pill')).toContainText('24° · clear sky');
  await expect(page.getByRole('button', { name: /Visit Atlanta Test Fountain/i })).toBeVisible();
  expect(weatherRequests).toHaveLength(1);
  expect(placeRequests).toHaveLength(1);
  expect(weatherRequests[0]).not.toContain('33.7490123');
  expect(weatherRequests[0]).not.toContain('-84.3879824');
  expect(placeRequests[0]).not.toContain('33.7490123');
  expect(placeRequests[0]).not.toContain('84.3879824');
  expect(consoleErrors).toEqual([]);
});

test('all 151 field-guide species construct as articulated 3D models', async ({ page }) => {
  const consoleErrors = await preparePage(page);
  await page.goto('/?reset=1');
  const result = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { SPECIES_CATALOG } = await import('/src/data/species.js');
    const { createMomentCreature } = await import('/src/lib/creature.js');
    const { createCreatureModel } = await import('/src/ui/creature-renderer.js');
    const weather = { temperature: 18, code: 2, wind: 5, isDay: true };
    const location = { lat: 40.7128, lng: -74.006 };
    const signatures = new Set();
    const failures = [];
    for (const species of SPECIES_CATALOG) {
      const creature = await createMomentCreature({
        seed: `catalog-preview-${species.number}`,
        location,
        weather,
        bucket: 981000,
        speciesNumber: species.number
      });
      const model = createCreatureModel(creature);
      let meshes = 0;
      model.traverse((object) => { if (object.isMesh) meshes += 1; });
      const parts = model.userData.parts;
      if (meshes < 4 || !parts.body.length || !parts.eyes.length || creature.genome.form.archetype === 'orbital') {
        failures.push({ number: species.number, meshes, archetype: creature.genome.form.archetype });
      }
      signatures.add([
        creature.genome.form.archetype,
        creature.genome.form.secondaryArchetype,
        creature.genome.form.bodyProfile,
        creature.genome.form.headStyle,
        creature.genome.form.signatureTrait,
        meshes
      ].join(':'));
      model.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose?.();
      });
    }
    return {
      count: SPECIES_CATALOG.length,
      archetypes: [...new Set(SPECIES_CATALOG.map((species) => species.archetype))],
      signatures: signatures.size,
      failures,
      boxClass: Boolean(THREE.Box3)
    };
  });
  expect(result.count).toBe(151);
  expect(result.archetypes).toHaveLength(12);
  expect(result.signatures).toBeGreaterThan(100);
  expect(result.failures).toEqual([]);
  expect(result.boxClass).toBe(true);
  expect(consoleErrors).toEqual([]);
});
