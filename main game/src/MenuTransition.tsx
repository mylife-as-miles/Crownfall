import { Component, createRef, type ReactNode } from "react";
import "./MenuTransition.css";

export interface MenuTransitionProps {
  viewKey: string;
  reducedMotion: boolean;
  direction?: number;
  children: ReactNode;
}

interface Snapshot {
  viewKey: string;
  nodes: HTMLElement[];
  scrollPositions: { node: Element; top: number; left: number }[];
}

// A DOM-only exit layer avoids retaining a second stateful Settings tree or refs.
function snapshotView(host: HTMLElement, viewKey: string): Snapshot {
  const scrollPositions: Snapshot["scrollPositions"] = [];
  const nodes = Array.from(host.children).map((source) => {
    const clone = source.cloneNode(true) as HTMLElement;
    const originals = [source, ...source.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    originals.forEach((original, index) => {
      const copy = copies[index];
      for (const attribute of ["id", "for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-activedescendant", "autofocus"]) copy.removeAttribute(attribute);
      if (copy instanceof HTMLElement) copy.tabIndex = -1;
      if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
        copy.value = original.value;
        copy.checked = original.checked;
      } else if (original instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) {
        copy.selectedIndex = original.selectedIndex;
      } else if (original instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) copy.value = original.value;
      if (original.scrollTop || original.scrollLeft) scrollPositions.push({ node: copy, top: original.scrollTop, left: original.scrollLeft });
      // Interruptions should fade the currently visible pose, not flash to full opacity.
      if (index === 0 || original.getAnimations().length || original.matches(".card-art, .home-tile-art")) {
        const style = getComputedStyle(original);
        if (copy instanceof HTMLElement || copy instanceof SVGElement) {
          copy.style.opacity = style.opacity;
          copy.style.transform = style.transform;
        }
      }
    });
    return clone;
  });
  return { viewKey, nodes, scrollPositions };
}

export default class MenuTransition extends Component<MenuTransitionProps, Record<string, never>, Snapshot | null> {
  private root = createRef<HTMLDivElement>();
  private live = createRef<HTMLDivElement>();
  private ghost = createRef<HTMLDivElement>();
  private animations: Animation[] = [];
  private generation = 0;
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  getSnapshotBeforeUpdate(previous: Readonly<MenuTransitionProps>): Snapshot | null {
    if (previous.viewKey === this.props.viewKey || this.props.reducedMotion || !this.live.current) return null;
    return snapshotView(this.live.current, previous.viewKey);
  }

  componentDidUpdate(previous: Readonly<MenuTransitionProps>, _state: Readonly<Record<string, never>>, snapshot: Snapshot | null) {
    if (this.props.reducedMotion) { this.clearTransition(); return; }
    if (previous.viewKey !== this.props.viewKey) this.startTransition(snapshot);
  }

  componentWillUnmount() { this.clearTransition(); }

  private clearTransition() {
    this.generation++;
    if (this.fallbackTimer !== undefined) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = undefined;
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
    this.ghost.current?.replaceChildren();
    this.ghost.current?.removeAttribute("data-view-key");
    if (this.root.current) this.root.current.dataset.transitionState = "idle";
  }

  private startTransition(snapshot: Snapshot | null) {
    this.clearTransition();
    const live = this.live.current;
    const ghost = this.ghost.current;
    if (!snapshot || !live || !ghost || typeof Element.prototype.animate !== "function") return;
    const generation = this.generation;
    const direction = this.props.direction && this.props.direction < 0 ? -1 : 1;
    if (this.root.current) this.root.current.dataset.transitionState = "running";
    ghost.dataset.viewKey = snapshot.viewKey;
    ghost.replaceChildren(...snapshot.nodes);
    snapshot.scrollPositions.forEach(({ node, top, left }) => { node.scrollTop = top; node.scrollLeft = left; });
    snapshot.nodes.forEach((node) => {
      const pose = getComputedStyle(node);
      this.animations.push(node.animate([
        { opacity: pose.opacity, transform: pose.transform },
        { opacity: 0, transform: `translate3d(${-8 * direction}px, 0, 0)` },
      ], { duration: 180, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "both" }));
    });
    Array.from(live.children).forEach((node) => {
      this.animations.push(node.animate([
        { opacity: 0, transform: `translate3d(${10 * direction}px, 0, 0)` },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ], { duration: 280, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "both" }));
      const tiles = node.querySelectorAll(":scope > .game-card, :scope > .home-tile, :scope > .settings-tile, :scope > .showcase-overview > .showcase-tile");
      tiles.forEach((tile, index) => {
        this.animations.push(tile.animate([
          { opacity: 0, transform: "translate3d(0, 7px, 0)" },
          { opacity: 1, transform: "translate3d(0, 0, 0)" },
        ], { duration: 220, delay: Math.min(index, 5) * 16, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "both" }));
      });
    });
    const finish = () => { if (this.generation === generation) this.clearTransition(); };
    void Promise.allSettled(this.animations.map((animation) => animation.finished)).then(finish);
    // A backgrounded document must never retain an inert exit layer indefinitely.
    this.fallbackTimer = setTimeout(finish, 800);
  }

  render() {
    return <div ref={this.root} className="menu-transition" data-view-key={this.props.viewKey} data-transition-state="idle">
      <div ref={this.live} className="menu-transition-live" data-view-key={this.props.viewKey}>{this.props.children}</div>
      <div ref={this.ghost} className="menu-transition-ghost" aria-hidden="true" inert />
    </div>;
  }
}
