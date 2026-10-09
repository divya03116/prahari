import { useMemo, useState } from 'react';

import { Contributions, EvidenceLegend, EvidenceText, FindingsGrid, RuleNet, ScoreBar } from '@/components/assessment';
import { TierBadge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/field';
import { Panel, PanelBody } from '@/components/ui/panel';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { analyse } from '@/shared/engine';

// Example reports are kept as written — the engine is reading exactly these words.
const EXAMPLES: { label: MessageKey; text: string }[] = [
  {
    label: 'demo.ex.scaffold',
    text: 'Scaffold third lift missing toe boards, fitter working directly below. Nobody was hurt.',
  },
  {
    label: 'demo.ex.gas',
    text: 'H2S alarm bypassed on the separator skid while the permit was still open.',
  },
  {
    label: 'demo.ex.hindi',
    text: 'Pump house mein valve se gas leak ho rahi thi, gas detector kaam nahi kar raha tha, operator paas mein khada tha.',
  },
  {
    label: 'demo.ex.housekeeping',
    text: 'Hose lying across the walkway near the pump house.',
  },
];

export default function EngineDemo() {
  const { t } = useI18n();
  const [text, setText] = useState(EXAMPLES[0].text);
  const result = useMemo(() => (text.trim().length >= 12 ? analyse(text) : null), [text]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel>
        <PanelBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-fg-subtle">{t('demo.examples')}</span>
            {EXAMPLES.map((e) => (
              <button
                key={e.label}
                type="button"
                onClick={() => setText(e.text)}
                className={cn(
                  'h-6 cursor-pointer rounded-sm border px-2 text-xs transition-colors',
                  text === e.text ? 'border-fg/40 bg-surface-3 text-fg' : 'border-border text-fg-muted hover:text-fg',
                )}
              >
                {t(e.label)}
              </button>
            ))}
          </div>
          <label htmlFor="demo-text" className="sr-only">
            {t('demo.label')}
          </label>
          <Textarea
            id="demo-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={4000}
            className="text-md leading-7"
            placeholder={t('demo.placeholder')}
          />
          {result && (
            <>
              <EvidenceText text={text} spans={result.evidence} className="text-sm leading-6" />
              <EvidenceLegend />
            </>
          )}
        </PanelBody>
      </Panel>

      <div className="flex min-w-0 flex-col gap-4">
        {result ? (
          <>
            <Panel>
              <PanelBody className="flex items-center gap-6">
                <div>
                  <p className="text-xs text-fg-subtle">{t('assess.sifPotential')}</p>
                  <p className="text-3xl font-semibold tracking-tight text-fg tabular" aria-live="polite">
                    {result.score}
                  </p>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <TierBadge tier={result.tier} />
                    <span className="text-xs text-fg-subtle">{t('detail.respondWithin', { window: result.responseWindow })}</span>
                  </div>
                  <ScoreBar score={result.score} tier={result.tier} />
                </div>
              </PanelBody>
            </Panel>
            <FindingsGrid energy={result.energy} barrier={result.barrier} exposure={result.exposure} />
            <RuleNet rules={result.rulesTriggered} escalated={result.escalated} preRuleScore={result.preRuleScore} />
            <Contributions items={result.contributions} score={result.score} />
          </>
        ) : (
          <Panel>
            <PanelBody>
              <p className="text-sm text-fg-subtle">{t('demo.empty')}</p>
            </PanelBody>
          </Panel>
        )}
      </div>
    </div>
  );
}
