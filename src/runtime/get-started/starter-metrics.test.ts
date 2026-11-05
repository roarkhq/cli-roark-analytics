import { STARTER_METRICS, metricOptions } from './starter-metrics';

const available = (...slugs: string[]) => slugs.map((slug) => ({ metricId: slug, name: slug.toUpperCase() }));

describe('metricOptions', () => {
  it('offers the curated metrics the project actually has', () => {
    const options = metricOptions(available('agent_responsive', 'call_ended_cleanly', 'something_else'));

    expect(options.choices.map((choice) => choice.value)).toEqual(['agent_responsive', 'call_ended_cleanly']);
    expect(options.recommended).toEqual(['agent_responsive', 'call_ended_cleanly']);
    expect(options.verified).toBe(true);
  });

  it("falls back to the project's own metrics when it carries almost none of the curated ones", () => {
    // An older stage or a trimmed project: offering slugs it does not have would guarantee a
    // rejected apply two steps later.
    const options = metricOptions(available('house_metric_a', 'house_metric_b', 'agent_responsive'));

    expect(options.choices.map((choice) => choice.value)).toEqual([
      'house_metric_a',
      'house_metric_b',
      'agent_responsive',
    ]);
    expect(options.recommended).toEqual(['house_metric_a', 'house_metric_b']);
    expect(options.verified).toBe(true);
  });

  it('marks the list unverified when the project could not be read', () => {
    const options = metricOptions(undefined);

    expect(options.choices).toHaveLength(STARTER_METRICS.length);
    expect(options.verified).toBe(false);
    expect(options.recommended.length).toBeGreaterThan(0);
  });

  it('recommends something whenever there is anything to offer, so Enter still grades the run', () => {
    // A plan with no metrics is rejected, so a non-empty list can never default to nothing.
    // `call_outcome`/`sentiment_score` are curated but not recommended, which is the case that
    // would otherwise hand back an empty default.
    for (const input of [undefined, available('call_outcome', 'sentiment_score')]) {
      const options = metricOptions(input);
      expect(options.choices.length).toBeGreaterThan(0);
      expect(options.recommended.length).toBeGreaterThan(0);
    }
  });

  it('offers nothing when the project has no metrics at all', () => {
    expect(metricOptions(available()).choices).toEqual([]);
  });

  it('ignores metrics with no slug', () => {
    const options = metricOptions([{ metricId: null, name: 'broken' }, ...available('agent_responsive')]);
    expect(options.choices.map((choice) => choice.value)).toEqual(['agent_responsive']);
  });
});
