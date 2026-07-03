import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    drinkFieldsFromLifestyle,
    lifestyleDrinkPatch,
} from '../../components/features/life-journal/lifeJournalMetrics.ts';

describe('life journal drink helpers', () => {
    it('maps coffee lifestyle to form state', () => {
        const state = drinkFieldsFromLifestyle({
            caffeine: { cups: 2, after_15h: true },
            custom_metrics: { drink_type: 'coffee' },
        });
        assert.equal(state.drinkType, 'coffee');
        assert.equal(state.drinkCups, '2');
        assert.equal(state.caffeineAfter15h, true);
    });

    it('maps water hydration to form state', () => {
        const state = drinkFieldsFromLifestyle({
            hydration_cups: 5,
            custom_metrics: { drink_type: 'water' },
        });
        assert.equal(state.drinkType, 'water');
        assert.equal(state.drinkCups, '5');
    });

    it('serializes coffee to caffeine jsonb and clears hydration', () => {
        const patch = lifestyleDrinkPatch('coffee', '3', true);
        assert.deepEqual(patch.caffeine, { cups: 3, after_15h: true });
        assert.deepEqual(patch.custom_metrics, { drink_type: 'coffee' });
        assert.equal(patch.hydration_cups, null);
    });

    it('serializes water to hydration_cups and clears caffeine', () => {
        const patch = lifestyleDrinkPatch('water', '6', false);
        assert.equal(patch.hydration_cups, 6);
        assert.deepEqual(patch.custom_metrics, { drink_type: 'water' });
        assert.deepEqual(patch.caffeine, {});
    });

    it('clears drink fields when type is deselected', () => {
        const patch = lifestyleDrinkPatch(null, '2', true);
        assert.equal(patch.hydration_cups, null);
        assert.deepEqual(patch.caffeine, {});
        assert.deepEqual(patch.custom_metrics, {});
    });

    it('clears drink fields when cups are empty but type is selected', () => {
        const patch = lifestyleDrinkPatch('tea', '  ', false);
        assert.equal(patch.hydration_cups, null);
        assert.deepEqual(patch.caffeine, {});
        assert.deepEqual(patch.custom_metrics, {});
    });
});