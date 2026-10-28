// Center canvas: vertical chain of step cards, with Paths branches and Loop containers.
import { Fragment } from 'react';
import {
  Plus, MoreHorizontal, Pencil, CopyPlus, ArrowUp, ArrowDown, Ban, Power, Trash2, AlertTriangle, Split, Repeat, Filter, Timer, Zap,
  Crown, Lock, ShieldAlert, Check, Star, Settings2,
} from 'lucide-react';
import { useApps } from '../../../lib/context.jsx';
import { AppIcon, Menu } from '../../../components/ui.jsx';
import { useEditor } from './context.js';
import { conditionSummary } from './defUtils.js';

function AddMenu({ loc, index, big }) {
  const { ops, plan } = useEditor();
  const items = [
    { section: 'Add a step' },
    { label: 'Action', icon: Zap, onClick: () => ops.addStep(loc, index, null) },
    { label: 'Filter', icon: Filter, onClick: () => ops.addStep(loc, index, 'filter') },
    { label: 'Paths', icon: Split, onClick: () => ops.addStep(loc, index, 'paths') },
    { label: 'Loop', icon: Repeat, onClick: () => ops.addStep(loc, index, 'looping') },
    { label: 'Delay', icon: Timer, onClick: () => ops.addStep(loc, index, 'delay') },
  ];
  return (
    <Menu align="left" width={210} items={items}
      trigger={big
        ? <button type="button" className="fe-add-big"><Plus />Add a step</button>
        : <button type="button" className="fe-add" aria-label="Add a step here" title="Add a step"><Plus /></button>} />
  );
}

function Connector({ loc, index, end, emptyChain }) {
  if (emptyChain) return <div className="fe-conn fe-conn-end"><span className="fe-line" /><AddMenu loc={loc} index={index} big /></div>;
  return (
    <div className={`fe-conn ${end ? 'fe-conn-end' : ''}`}>
      <span className="fe-line" />
      <AddMenu loc={loc} index={index} />
      {!end && <span className="fe-line" />}
    </div>
  );
}

function StepCard({ node, isTrigger, index, chainLength }) {
  const { getApp } = useApps();
  const { selection, select, numbers, issues, ops, plan } = useEditor();
  const id = isTrigger ? 'trigger' : node.id;
  const app = getApp(node.app);
  const ev = app ? (isTrigger ? app.triggers?.[node.event] : app.actions?.[node.action]) : null;
  const selected = isTrigger ? selection?.type === 'trigger' : selection?.type === 'step' && selection.id === id;
  const title = node.title || (app ? `${app.name}${ev ? ` · ${ev.name}` : ''}` : isTrigger ? 'Choose the event that starts your flow' : 'Choose an app & action');
  const sub = app ? (ev ? (node.title ? `${app.name} · ${ev.name}` : ev.description) : `Choose ${isTrigger ? 'a trigger event' : 'an action'}`) : isTrigger ? 'Pick an app and event to start' : 'Pick what this step should do';
  const warns = issues[id] || [];

  const menuItems = isTrigger ? [
    { label: 'Rename', icon: Pencil, onClick: () => ops.rename('trigger') },
    { label: 'Change trigger', icon: Settings2, onClick: () => select({ type: 'trigger' }) },
  ] : [
    { label: 'Rename', icon: Pencil, onClick: () => ops.rename(id) },
    { label: 'Duplicate', icon: CopyPlus, onClick: () => ops.duplicate(id) },
    { label: 'Move up', icon: ArrowUp, disabled: index === 0, onClick: () => ops.move(id, -1) },
    { label: 'Move down', icon: ArrowDown, disabled: index >= chainLength - 1, onClick: () => ops.move(id, 1) },
    { divider: true },
    { label: node.disabled ? 'Enable step' : 'Disable step', icon: node.disabled ? Power : Ban, onClick: () => ops.toggleDisabled(id) },
    { section: 'On error' },
    { label: 'Stop flow', icon: node.onError !== 'continue' ? Check : undefined, hint: node.onError !== 'continue' ? 'current' : '', onClick: () => ops.setOnError(id, 'halt') },
    { label: 'Continue to next step', icon: node.onError === 'continue' ? Check : undefined, hint: node.onError === 'continue' ? 'current' : '', onClick: () => ops.setOnError(id, 'continue') },
    { divider: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => ops.remove(id) },
  ];

  return (
    <div
      className={`fe-card ${selected ? 'selected' : ''} ${node.disabled ? 'is-disabled' : ''} ${!app ? 'is-empty' : ''} ${isTrigger ? 'is-trigger' : ''}`}
      role="button" tabIndex={0} aria-pressed={selected}
      onClick={() => select(isTrigger ? { type: 'trigger' } : { type: 'step', id })}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(isTrigger ? { type: 'trigger' } : { type: 'step', id }); } }}
    >
      <div className="fe-card-main">
        <AppIcon app={app} size={38} />
        <div className="fe-card-text">
          <div className="fe-card-kind">
            {isTrigger ? <><Zap />Trigger</> : app?.control ? (node.app === 'paths' ? <><Split />Paths</> : node.app === 'looping' ? <><Repeat />Loop</> : node.app === 'filter' ? <><Filter />Filter</> : <>Action</>) : <>Action</>}
          </div>
          <div className="fe-card-title" title={title}><span className="fe-card-num">{numbers[id]}.</span> {title}</div>
          <div className="fe-card-sub" title={sub}>{sub}</div>
        </div>
        <Menu width={220} items={menuItems} trigger={<button type="button" className="fe-card-menu" aria-label="Step options"><MoreHorizontal /></button>} />
      </div>
      {(warns.length > 0 || node.disabled || node.onError === 'continue') && (
        <div className="fe-card-chips">
          {warns.length > 0 && <span className="fe-chip fe-chip-warn" title={warns.join('\n')}><AlertTriangle />{warns.length === 1 ? warns[0] : `${warns.length} things to fix`}</span>}
          {node.disabled && <span className="fe-chip"><Ban />Disabled</span>}
          {node.onError === 'continue' && <span className="fe-chip fe-chip-info"><ShieldAlert />Continues on error</span>}
        </div>
      )}
    </div>
  );
}

function PathsNode({ step, index, chainLength }) {
  const { selection, select, ops, issues } = useEditor();
  const paths = step.paths || [];
  return (
    <div className="fe-node">
      <StepCard node={step} index={index} chainLength={chainLength} />
      <span className="fe-line fe-line-solo" />
      <div className="fe-branches">
        {paths.map((p, i) => {
          const sel = selection?.type === 'path' && selection.pathId === p.id;
          const noRules = !p.fallback && !(p.conditions || []).flat().length;
          return (
            <div key={p.id} className="fe-branch">
              <div className={`fe-branch-head ${sel ? 'selected' : ''}`} role="button" tabIndex={0}
                onClick={() => select({ type: 'path', stepId: step.id, pathId: p.id })}
                onKeyDown={(e) => e.key === 'Enter' && select({ type: 'path', stepId: step.id, pathId: p.id })}>
                <div className="row" style={{ gap: 6 }}>
                  <Split size={14} className="fe-branch-icon" />
                  <span className="bold small grow truncate">{p.name || `Path ${String.fromCharCode(65 + i)}`}</span>
                  {p.fallback && <span className="badge badge-blue">Fallback</span>}
                  <Menu width={200} items={[
                    { label: 'Edit rules', icon: Pencil, onClick: () => select({ type: 'path', stepId: step.id, pathId: p.id }) },
                    { label: 'Rename', icon: Pencil, onClick: () => ops.renamePath(step.id, p.id) },
                    { label: p.fallback ? 'Unset fallback' : 'Make fallback path', icon: Star, onClick: () => ops.setFallback(step.id, p.id, !p.fallback) },
                    { divider: true },
                    { label: 'Delete path', icon: Trash2, danger: true, onClick: () => ops.removePath(step.id, p.id) },
                  ]} trigger={<button type="button" className="fe-card-menu sm" aria-label="Path options"><MoreHorizontal /></button>} />
                </div>
                <div className={`tiny ${noRules ? 'fe-warn-text' : 'subtle'} fe-branch-rule`}>
                  {noRules && <AlertTriangle size={12} />}
                  {p.fallback ? 'Runs when no other path matches' : noRules ? 'Set up rules for this path' : `Only if ${conditionSummary(p.conditions)}`}
                </div>
              </div>
              <Chain loc={{ parentId: step.id, pathId: p.id }} steps={p.steps || []} nested />
            </div>
          );
        })}
        <div className="fe-branch fe-branch-add">
          <button type="button" className="fe-add-path" onClick={() => ops.addPath(step.id)}><Plus />Add path</button>
        </div>
      </div>
      {!paths.length && (issues[step.id] || []).length > 0 && <div className="tiny fe-warn-text mt-8">Add at least one path.</div>}
    </div>
  );
}

function LoopNode({ step, index, chainLength }) {
  return (
    <div className="fe-node">
      <StepCard node={step} index={index} chainLength={chainLength} />
      <span className="fe-line fe-line-solo" />
      <div className="fe-loop">
        <div className="fe-loop-label"><Repeat />For each item{step.params?.items ? <span className="mono subtle truncate"> in {String(step.params.items)}</span> : null}</div>
        <Chain loc={{ parentId: step.id }} steps={step.steps || []} nested />
      </div>
    </div>
  );
}

export function Chain({ loc, steps, nested }) {
  return (
    <div className={`fe-chain ${nested ? 'nested' : ''}`}>
      {steps.map((st, i) => (
        <Fragment key={st.id}>
          {(i > 0 || nested) && <Connector loc={loc} index={i} />}
          {st.app === 'paths' ? <PathsNode step={st} index={i} chainLength={steps.length} />
            : st.app === 'looping' ? <LoopNode step={st} index={i} chainLength={steps.length} />
            : <StepCard node={st} index={i} chainLength={steps.length} />}
        </Fragment>
      ))}
      <Connector loc={loc} index={steps.length} end emptyChain={!steps.length} />
    </div>
  );
}

export default function Canvas({ def, onBackgroundClick, children }) {
  return (
    <div className="editor-canvas fe-canvas" onMouseDown={(e) => { if (e.target === e.currentTarget || e.target.classList?.contains('fe-canvas-inner')) onBackgroundClick?.(); }}>
      <div className="fe-canvas-inner">
        {children}
        <StepCard node={def.trigger} isTrigger index={0} chainLength={1} />
        {def.steps.length > 0 && <Connector loc={{ parentId: null }} index={0} />}
        <Chain loc={{ parentId: null }} steps={def.steps} />
      </div>
    </div>
  );
}
