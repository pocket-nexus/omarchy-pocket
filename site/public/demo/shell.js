(() => {
  // vendor/pocketjs/node_modules/solid-js/dist/solid.js
  var sharedConfig = {
    context: undefined,
    registry: undefined,
    effects: undefined,
    done: false,
    getContextId() {
      return getContextId(this.context.count);
    },
    getNextContextId() {
      return getContextId(this.context.count++);
    }
  };
  function getContextId(count) {
    const num = String(count), len = num.length - 1;
    return sharedConfig.context.id + (len ? String.fromCharCode(96 + len) : "") + num;
  }
  function setHydrateContext(context) {
    sharedConfig.context = context;
  }
  function nextHydrateContext() {
    return {
      ...sharedConfig.context,
      id: sharedConfig.getNextContextId(),
      count: 0
    };
  }
  var IS_DEV = false;
  var equalFn = (a, b) => a === b;
  var $PROXY = Symbol("solid-proxy");
  var SUPPORTS_PROXY = typeof Proxy === "function";
  var $TRACK = Symbol("solid-track");
  var $DEVCOMP = Symbol("solid-dev-component");
  var signalOptions = {
    equals: equalFn
  };
  var ERROR = null;
  var runEffects = runQueue;
  var STALE = 1;
  var PENDING = 2;
  var UNOWNED = {
    owned: null,
    cleanups: null,
    context: null,
    owner: null
  };
  var Owner = null;
  var Transition = null;
  var Scheduler = null;
  var ExternalSourceConfig = null;
  var Listener = null;
  var Updates = null;
  var Effects = null;
  var ExecCount = 0;
  function createRoot(fn, detachedOwner) {
    const listener = Listener, owner = Owner, unowned = fn.length === 0, current = detachedOwner === undefined ? owner : detachedOwner, root = unowned ? UNOWNED : {
      owned: null,
      cleanups: null,
      context: current ? current.context : null,
      owner: current
    }, updateFn = unowned ? fn : () => fn(() => untrack(() => cleanNode(root)));
    Owner = root;
    Listener = null;
    try {
      return runUpdates(updateFn, true);
    } finally {
      Listener = listener;
      Owner = owner;
    }
  }
  function createSignal(value, options) {
    options = options ? Object.assign({}, signalOptions, options) : signalOptions;
    const s = {
      value,
      observers: null,
      observerSlots: null,
      comparator: options.equals || undefined
    };
    const setter = (value) => {
      if (typeof value === "function") {
        if (Transition && Transition.running && Transition.sources.has(s))
          value = value(s.tValue);
        else
          value = value(s.value);
      }
      return writeSignal(s, value);
    };
    return [readSignal.bind(s), setter];
  }
  function createRenderEffect(fn, value, options) {
    const c = createComputation(fn, value, false, STALE);
    if (Scheduler && Transition && Transition.running)
      Updates.push(c);
    else
      updateComputation(c);
  }
  function createEffect(fn, value, options) {
    runEffects = runUserEffects;
    const c = createComputation(fn, value, false, STALE), s = SuspenseContext && useContext(SuspenseContext);
    if (s)
      c.suspense = s;
    if (!options || !options.render)
      c.user = true;
    Effects ? Effects.push(c) : updateComputation(c);
  }
  function createMemo(fn, value, options) {
    options = options ? Object.assign({}, signalOptions, options) : signalOptions;
    const c = createComputation(fn, value, true, 0);
    c.observers = null;
    c.observerSlots = null;
    c.comparator = options.equals || undefined;
    if (Scheduler && Transition && Transition.running) {
      c.tState = STALE;
      Updates.push(c);
    } else
      updateComputation(c);
    return readSignal.bind(c);
  }
  function batch(fn) {
    return runUpdates(fn, false);
  }
  function untrack(fn) {
    if (!ExternalSourceConfig && Listener === null)
      return fn();
    const listener = Listener;
    Listener = null;
    try {
      if (ExternalSourceConfig)
        return ExternalSourceConfig.untrack(fn);
      return fn();
    } finally {
      Listener = listener;
    }
  }
  function on(deps, fn, options) {
    const isArray = Array.isArray(deps);
    let prevInput;
    let defer = options && options.defer;
    return (prevValue) => {
      let input;
      if (isArray) {
        input = Array(deps.length);
        for (let i = 0;i < deps.length; i++)
          input[i] = deps[i]();
      } else
        input = deps();
      if (defer) {
        defer = false;
        return prevValue;
      }
      const result = untrack(() => fn(input, prevInput, prevValue));
      prevInput = input;
      return result;
    };
  }
  function onMount(fn) {
    createEffect(() => untrack(fn));
  }
  function onCleanup(fn) {
    if (Owner === null)
      ;
    else if (Owner.cleanups === null)
      Owner.cleanups = [fn];
    else
      Owner.cleanups.push(fn);
    return fn;
  }
  function startTransition(fn) {
    if (Transition && Transition.running) {
      fn();
      return Transition.done;
    }
    const l = Listener;
    const o = Owner;
    return Promise.resolve().then(() => {
      Listener = l;
      Owner = o;
      let t;
      if (Scheduler || SuspenseContext) {
        t = Transition || (Transition = {
          sources: new Set,
          effects: [],
          promises: new Set,
          disposed: new Set,
          queue: new Set,
          running: true
        });
        t.done || (t.done = new Promise((res) => t.resolve = res));
        t.running = true;
      }
      runUpdates(fn, false);
      Listener = Owner = null;
      return t ? t.done : undefined;
    });
  }
  var [transPending, setTransPending] = /* @__PURE__ */ createSignal(false);
  function createContext(defaultValue, options) {
    const id = Symbol("context");
    return {
      id,
      Provider: createProvider(id),
      defaultValue
    };
  }
  function useContext(context) {
    let value;
    return Owner && Owner.context && (value = Owner.context[context.id]) !== undefined ? value : context.defaultValue;
  }
  function children(fn) {
    const children = createMemo(fn);
    const memo = createMemo(() => resolveChildren(children()));
    memo.toArray = () => {
      const c = memo();
      return Array.isArray(c) ? c : c != null ? [c] : [];
    };
    return memo;
  }
  var SuspenseContext;
  function readSignal() {
    const runningTransition = Transition && Transition.running;
    if (this.sources && (runningTransition ? this.tState : this.state)) {
      if ((runningTransition ? this.tState : this.state) === STALE)
        updateComputation(this);
      else {
        const updates = Updates;
        Updates = null;
        runUpdates(() => lookUpstream(this), false);
        Updates = updates;
      }
    }
    if (Listener) {
      const observers = this.observers;
      if (!observers || observers[observers.length - 1] !== Listener) {
        const sSlot = observers ? observers.length : 0;
        if (!Listener.sources) {
          Listener.sources = [this];
          Listener.sourceSlots = [sSlot];
        } else {
          Listener.sources.push(this);
          Listener.sourceSlots.push(sSlot);
        }
        if (!observers) {
          this.observers = [Listener];
          this.observerSlots = [Listener.sources.length - 1];
        } else {
          observers.push(Listener);
          this.observerSlots.push(Listener.sources.length - 1);
        }
      }
    }
    if (runningTransition && Transition.sources.has(this))
      return this.tValue;
    return this.value;
  }
  function writeSignal(node, value, isComp) {
    let current = Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value;
    if (!node.comparator || !node.comparator(current, value)) {
      if (Transition) {
        const TransitionRunning = Transition.running;
        if (TransitionRunning || !isComp && Transition.sources.has(node)) {
          Transition.sources.add(node);
          node.tValue = value;
        }
        if (!TransitionRunning)
          node.value = value;
      } else
        node.value = value;
      if (node.observers && node.observers.length) {
        runUpdates(() => {
          for (let i = 0;i < node.observers.length; i += 1) {
            const o = node.observers[i];
            const TransitionRunning = Transition && Transition.running;
            if (TransitionRunning && Transition.disposed.has(o))
              continue;
            if (TransitionRunning ? !o.tState : !o.state) {
              if (o.pure)
                Updates.push(o);
              else
                Effects.push(o);
              if (o.observers)
                markDownstream(o);
            }
            if (!TransitionRunning)
              o.state = STALE;
            else
              o.tState = STALE;
          }
          if (Updates.length > 1e6) {
            Updates = [];
            if (IS_DEV)
              ;
            throw new Error;
          }
        }, false);
      }
    }
    return value;
  }
  function updateComputation(node) {
    if (!node.fn)
      return;
    cleanNode(node);
    const time = ExecCount;
    runComputation(node, Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value, time);
    if (Transition && !Transition.running && Transition.sources.has(node)) {
      queueMicrotask(() => {
        runUpdates(() => {
          Transition && (Transition.running = true);
          Listener = Owner = node;
          runComputation(node, node.tValue, time);
          Listener = Owner = null;
        }, false);
      });
    }
  }
  function runComputation(node, value, time) {
    let nextValue;
    const owner = Owner, listener = Listener;
    Listener = Owner = node;
    try {
      nextValue = node.fn(value);
    } catch (err) {
      if (node.pure) {
        if (Transition && Transition.running) {
          node.tState = STALE;
          node.tOwned && node.tOwned.forEach(cleanNode);
          node.tOwned = undefined;
        } else {
          node.state = STALE;
          node.owned && node.owned.forEach(cleanNode);
          node.owned = null;
        }
      }
      node.updatedAt = time + 1;
      return handleError(err);
    } finally {
      Listener = listener;
      Owner = owner;
    }
    if (!node.updatedAt || node.updatedAt <= time) {
      if (node.updatedAt != null && "observers" in node) {
        writeSignal(node, nextValue, true);
      } else if (Transition && Transition.running && node.pure) {
        if (!Transition.sources.has(node))
          node.value = nextValue;
        Transition.sources.add(node);
        node.tValue = nextValue;
      } else
        node.value = nextValue;
      node.updatedAt = time;
    }
  }
  function createComputation(fn, init, pure, state = STALE, options) {
    const c = {
      fn,
      state,
      updatedAt: null,
      owned: null,
      sources: null,
      sourceSlots: null,
      cleanups: null,
      value: init,
      owner: Owner,
      context: Owner ? Owner.context : null,
      pure
    };
    if (Transition && Transition.running) {
      c.state = 0;
      c.tState = state;
    }
    if (Owner === null)
      ;
    else if (Owner !== UNOWNED) {
      if (Transition && Transition.running && Owner.pure) {
        if (!Owner.tOwned)
          Owner.tOwned = [c];
        else
          Owner.tOwned.push(c);
      } else {
        if (!Owner.owned)
          Owner.owned = [c];
        else
          Owner.owned.push(c);
      }
    }
    if (ExternalSourceConfig && c.fn) {
      const sourceFn = c.fn;
      const [track, trigger] = createSignal(undefined, {
        equals: false
      });
      const ordinary = ExternalSourceConfig.factory(sourceFn, trigger);
      onCleanup(() => ordinary.dispose());
      let inTransition;
      const triggerInTransition = () => startTransition(trigger).then(() => {
        if (inTransition) {
          inTransition.dispose();
          inTransition = undefined;
        }
      });
      c.fn = (x) => {
        track();
        if (Transition && Transition.running) {
          if (!inTransition)
            inTransition = ExternalSourceConfig.factory(sourceFn, triggerInTransition);
          return inTransition.track(x);
        }
        return ordinary.track(x);
      };
    }
    return c;
  }
  function runTop(node) {
    const runningTransition = Transition && Transition.running;
    if ((runningTransition ? node.tState : node.state) === 0)
      return;
    if ((runningTransition ? node.tState : node.state) === PENDING)
      return lookUpstream(node);
    if (node.suspense && untrack(node.suspense.inFallback))
      return node.suspense.effects.push(node);
    const ancestors = [node];
    while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
      if (runningTransition && Transition.disposed.has(node))
        return;
      if (runningTransition ? node.tState : node.state)
        ancestors.push(node);
    }
    for (let i = ancestors.length - 1;i >= 0; i--) {
      node = ancestors[i];
      if (runningTransition) {
        let top = node, prev = ancestors[i + 1];
        while ((top = top.owner) && top !== prev) {
          if (Transition.disposed.has(top))
            return;
        }
      }
      if ((runningTransition ? node.tState : node.state) === STALE) {
        updateComputation(node);
      } else if ((runningTransition ? node.tState : node.state) === PENDING) {
        const updates = Updates;
        Updates = null;
        runUpdates(() => lookUpstream(node, ancestors[0]), false);
        Updates = updates;
      }
    }
  }
  function runUpdates(fn, init) {
    if (Updates)
      return fn();
    let wait = false;
    if (!init)
      Updates = [];
    if (Effects)
      wait = true;
    else
      Effects = [];
    ExecCount++;
    try {
      const res = fn();
      completeUpdates(wait);
      return res;
    } catch (err) {
      if (!wait)
        Effects = null;
      Updates = null;
      handleError(err);
    }
  }
  function completeUpdates(wait) {
    if (Updates) {
      if (Scheduler && Transition && Transition.running)
        scheduleQueue(Updates);
      else
        runQueue(Updates);
      Updates = null;
    }
    if (wait)
      return;
    let res;
    if (Transition) {
      if (!Transition.promises.size && !Transition.queue.size) {
        const sources = Transition.sources;
        const disposed = Transition.disposed;
        Effects.push.apply(Effects, Transition.effects);
        res = Transition.resolve;
        for (const e of Effects) {
          "tState" in e && (e.state = e.tState);
          delete e.tState;
        }
        Transition = null;
        runUpdates(() => {
          for (const d of disposed)
            cleanNode(d);
          for (const v of sources) {
            v.value = v.tValue;
            if (v.owned) {
              for (let i = 0, len = v.owned.length;i < len; i++)
                cleanNode(v.owned[i]);
            }
            if (v.tOwned)
              v.owned = v.tOwned;
            delete v.tValue;
            delete v.tOwned;
            v.tState = 0;
          }
          setTransPending(false);
        }, false);
      } else if (Transition.running) {
        Transition.running = false;
        Transition.effects.push.apply(Transition.effects, Effects);
        Effects = null;
        setTransPending(true);
        return;
      }
    }
    const e = Effects;
    Effects = null;
    if (e.length)
      runUpdates(() => runEffects(e), false);
    if (res)
      res();
  }
  function runQueue(queue) {
    for (let i = 0;i < queue.length; i++)
      runTop(queue[i]);
  }
  function scheduleQueue(queue) {
    for (let i = 0;i < queue.length; i++) {
      const item = queue[i];
      const tasks = Transition.queue;
      if (!tasks.has(item)) {
        tasks.add(item);
        Scheduler(() => {
          tasks.delete(item);
          runUpdates(() => {
            Transition.running = true;
            runTop(item);
          }, false);
          Transition && (Transition.running = false);
        });
      }
    }
  }
  function runUserEffects(queue) {
    let i, userLength = 0;
    for (i = 0;i < queue.length; i++) {
      const e = queue[i];
      if (!e.user)
        runTop(e);
      else
        queue[userLength++] = e;
    }
    if (sharedConfig.context) {
      if (sharedConfig.count) {
        sharedConfig.effects || (sharedConfig.effects = []);
        sharedConfig.effects.push(...queue.slice(0, userLength));
        return;
      }
      setHydrateContext();
    }
    if (sharedConfig.effects && (sharedConfig.done || !sharedConfig.count)) {
      queue = [...sharedConfig.effects, ...queue];
      userLength += sharedConfig.effects.length;
      delete sharedConfig.effects;
    }
    for (i = 0;i < userLength; i++)
      runTop(queue[i]);
  }
  function lookUpstream(node, ignore) {
    const runningTransition = Transition && Transition.running;
    if (runningTransition)
      node.tState = 0;
    else
      node.state = 0;
    for (let i = 0;i < node.sources.length; i += 1) {
      const source = node.sources[i];
      if (source.sources) {
        const state = runningTransition ? source.tState : source.state;
        if (state === STALE) {
          if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount))
            runTop(source);
        } else if (state === PENDING)
          lookUpstream(source, ignore);
      }
    }
  }
  function markDownstream(node) {
    const runningTransition = Transition && Transition.running;
    for (let i = 0;i < node.observers.length; i += 1) {
      const o = node.observers[i];
      if (runningTransition ? !o.tState : !o.state) {
        if (runningTransition)
          o.tState = PENDING;
        else
          o.state = PENDING;
        if (o.pure)
          Updates.push(o);
        else
          Effects.push(o);
        o.observers && markDownstream(o);
      }
    }
  }
  function cleanNode(node) {
    let i;
    if (node.sources) {
      while (node.sources.length) {
        const source = node.sources.pop(), index = node.sourceSlots.pop(), obs = source.observers;
        if (obs && obs.length) {
          const n = obs.pop(), s = source.observerSlots.pop();
          if (index < obs.length) {
            n.sourceSlots[s] = index;
            obs[index] = n;
            source.observerSlots[index] = s;
          }
        }
      }
    }
    if (node.tOwned) {
      for (i = node.tOwned.length - 1;i >= 0; i--)
        cleanNode(node.tOwned[i]);
      delete node.tOwned;
    }
    if (Transition && Transition.running && node.pure) {
      reset(node, true);
    } else if (node.owned) {
      for (i = node.owned.length - 1;i >= 0; i--)
        cleanNode(node.owned[i]);
      node.owned = null;
    }
    if (node.cleanups) {
      for (i = node.cleanups.length - 1;i >= 0; i--)
        node.cleanups[i]();
      node.cleanups = null;
    }
    if (Transition && Transition.running)
      node.tState = 0;
    else
      node.state = 0;
  }
  function reset(node, top) {
    if (!top) {
      node.tState = 0;
      Transition.disposed.add(node);
    }
    if (node.owned) {
      for (let i = 0;i < node.owned.length; i++)
        reset(node.owned[i]);
    }
  }
  function castError(err) {
    if (err instanceof Error)
      return err;
    return new Error(typeof err === "string" ? err : "Unknown error", {
      cause: err
    });
  }
  function runErrors(err, fns, owner) {
    try {
      for (const f of fns)
        f(err);
    } catch (e) {
      handleError(e, owner && owner.owner || null);
    }
  }
  function handleError(err, owner = Owner) {
    const fns = ERROR && owner && owner.context && owner.context[ERROR];
    const error = castError(err);
    if (!fns)
      throw error;
    if (Effects)
      Effects.push({
        fn() {
          runErrors(error, fns, owner);
        },
        state: STALE
      });
    else
      runErrors(error, fns, owner);
  }
  function resolveChildren(children) {
    if (typeof children === "function" && !children.length)
      return resolveChildren(children());
    if (Array.isArray(children)) {
      const results = [];
      for (let i = 0;i < children.length; i++) {
        const result = resolveChildren(children[i]);
        if (Array.isArray(result)) {
          if (result.length < 32768)
            results.push.apply(results, result);
          else
            for (let j = 0;j < result.length; j++)
              results.push(result[j]);
        } else {
          results.push(result);
        }
      }
      return results;
    }
    return children;
  }
  function createProvider(id, options) {
    return function provider(props) {
      let res;
      createRenderEffect(() => res = untrack(() => {
        Owner.context = {
          ...Owner.context,
          [id]: props.value
        };
        return children(() => props.children);
      }), undefined);
      return res;
    };
  }
  var FALLBACK = Symbol("fallback");
  function dispose(d) {
    for (let i = 0;i < d.length; i++)
      d[i]();
  }
  function mapArray(list, mapFn, options = {}) {
    let items = [], mapped = [], disposers = [], len = 0, indexes = mapFn.length > 1 ? [] : null;
    onCleanup(() => dispose(disposers));
    return () => {
      let newItems = list() || [], newLen = newItems.length, i, j;
      newItems[$TRACK];
      return untrack(() => {
        let newIndices, newIndicesNext, temp, tempdisposers, tempIndexes, start, end, newEnd, item;
        if (newLen === 0) {
          if (len !== 0) {
            dispose(disposers);
            disposers = [];
            items = [];
            mapped = [];
            len = 0;
            indexes && (indexes = []);
          }
          if (options.fallback) {
            items = [FALLBACK];
            mapped[0] = createRoot((disposer) => {
              disposers[0] = disposer;
              return options.fallback();
            });
            len = 1;
          }
        } else if (len === 0) {
          mapped = new Array(newLen);
          for (j = 0;j < newLen; j++) {
            items[j] = newItems[j];
            mapped[j] = createRoot(mapper);
          }
          len = newLen;
        } else {
          temp = new Array(newLen);
          tempdisposers = new Array(newLen);
          indexes && (tempIndexes = new Array(newLen));
          for (start = 0, end = Math.min(len, newLen);start < end && items[start] === newItems[start]; start++)
            ;
          for (end = len - 1, newEnd = newLen - 1;end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
            temp[newEnd] = mapped[end];
            tempdisposers[newEnd] = disposers[end];
            indexes && (tempIndexes[newEnd] = indexes[end]);
          }
          newIndices = new Map;
          newIndicesNext = new Array(newEnd + 1);
          for (j = newEnd;j >= start; j--) {
            item = newItems[j];
            i = newIndices.get(item);
            newIndicesNext[j] = i === undefined ? -1 : i;
            newIndices.set(item, j);
          }
          for (i = start;i <= end; i++) {
            item = items[i];
            j = newIndices.get(item);
            if (j !== undefined && j !== -1) {
              temp[j] = mapped[i];
              tempdisposers[j] = disposers[i];
              indexes && (tempIndexes[j] = indexes[i]);
              j = newIndicesNext[j];
              newIndices.set(item, j);
            } else
              disposers[i]();
          }
          for (j = start;j < newLen; j++) {
            if (j in temp) {
              mapped[j] = temp[j];
              disposers[j] = tempdisposers[j];
              if (indexes) {
                indexes[j] = tempIndexes[j];
                indexes[j](j);
              }
            } else
              mapped[j] = createRoot(mapper);
          }
          mapped = mapped.slice(0, len = newLen);
          items = newItems.slice(0);
        }
        return mapped;
      });
      function mapper(disposer) {
        disposers[j] = disposer;
        if (indexes) {
          const [s, set] = createSignal(j);
          indexes[j] = set;
          return mapFn(newItems[j], s);
        }
        return mapFn(newItems[j]);
      }
    };
  }
  function indexArray(list, mapFn, options = {}) {
    let items = [], mapped = [], disposers = [], signals = [], len = 0, i;
    onCleanup(() => dispose(disposers));
    return () => {
      const newItems = list() || [], newLen = newItems.length;
      newItems[$TRACK];
      return untrack(() => {
        if (newLen === 0) {
          if (len !== 0) {
            dispose(disposers);
            disposers = [];
            items = [];
            mapped = [];
            len = 0;
            signals = [];
          }
          if (options.fallback) {
            items = [FALLBACK];
            mapped[0] = createRoot((disposer) => {
              disposers[0] = disposer;
              return options.fallback();
            });
            len = 1;
          }
          return mapped;
        }
        if (items[0] === FALLBACK) {
          disposers[0]();
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
        }
        for (i = 0;i < newLen; i++) {
          if (i < items.length && items[i] !== newItems[i]) {
            signals[i](() => newItems[i]);
          } else if (i >= items.length) {
            mapped[i] = createRoot(mapper);
          }
        }
        for (;i < items.length; i++) {
          disposers[i]();
        }
        len = signals.length = disposers.length = newLen;
        items = newItems.slice(0);
        return mapped = mapped.slice(0, len);
      });
      function mapper(disposer) {
        disposers[i] = disposer;
        const [s, set] = createSignal(newItems[i]);
        signals[i] = set;
        return mapFn(s, i);
      }
    };
  }
  var hydrationEnabled = false;
  function createComponent(Comp, props) {
    if (hydrationEnabled) {
      if (sharedConfig.context) {
        const c = sharedConfig.context;
        setHydrateContext(nextHydrateContext());
        const r = untrack(() => Comp(props || {}));
        setHydrateContext(c);
        return r;
      }
    }
    return untrack(() => Comp(props || {}));
  }
  function trueFn() {
    return true;
  }
  var propTraps = {
    get(_, property, receiver) {
      if (property === $PROXY)
        return receiver;
      return _.get(property);
    },
    has(_, property) {
      if (property === $PROXY)
        return true;
      return _.has(property);
    },
    set: trueFn,
    deleteProperty: trueFn,
    getOwnPropertyDescriptor(_, property) {
      return {
        configurable: true,
        enumerable: true,
        get() {
          return _.get(property);
        },
        set: trueFn,
        deleteProperty: trueFn
      };
    },
    ownKeys(_) {
      return _.keys();
    }
  };
  function resolveSource(s) {
    return !(s = typeof s === "function" ? s() : s) ? {} : s;
  }
  function resolveSources() {
    for (let i = 0, length = this.length;i < length; ++i) {
      const v = this[i]();
      if (v !== undefined)
        return v;
    }
  }
  function mergeProps(...sources) {
    let proxy = false;
    for (let i = 0;i < sources.length; i++) {
      const s = sources[i];
      proxy = proxy || !!s && $PROXY in s;
      sources[i] = typeof s === "function" ? (proxy = true, createMemo(s)) : s;
    }
    if (SUPPORTS_PROXY && proxy) {
      return new Proxy({
        get(property) {
          for (let i = sources.length - 1;i >= 0; i--) {
            const v = resolveSource(sources[i])[property];
            if (v !== undefined)
              return v;
          }
        },
        has(property) {
          for (let i = sources.length - 1;i >= 0; i--) {
            if (property in resolveSource(sources[i]))
              return true;
          }
          return false;
        },
        keys() {
          const keys = [];
          for (let i = 0;i < sources.length; i++)
            keys.push(...Object.keys(resolveSource(sources[i])));
          return [...new Set(keys)];
        }
      }, propTraps);
    }
    const sourcesMap = {};
    const defined = Object.create(null);
    for (let i = sources.length - 1;i >= 0; i--) {
      const source = sources[i];
      if (!source)
        continue;
      const sourceKeys = Object.getOwnPropertyNames(source);
      for (let i = sourceKeys.length - 1;i >= 0; i--) {
        const key = sourceKeys[i];
        if (key === "__proto__" || key === "constructor")
          continue;
        const desc = Object.getOwnPropertyDescriptor(source, key);
        if (!defined[key]) {
          defined[key] = desc.get ? {
            enumerable: true,
            configurable: true,
            get: resolveSources.bind(sourcesMap[key] = [desc.get.bind(source)])
          } : desc.value !== undefined ? desc : undefined;
        } else {
          const sources = sourcesMap[key];
          if (sources) {
            if (desc.get)
              sources.push(desc.get.bind(source));
            else if (desc.value !== undefined)
              sources.push(() => desc.value);
          }
        }
      }
    }
    const target = {};
    const definedKeys = Object.keys(defined);
    for (let i = definedKeys.length - 1;i >= 0; i--) {
      const key = definedKeys[i], desc = defined[key];
      if (desc && desc.get)
        Object.defineProperty(target, key, desc);
      else
        target[key] = desc ? desc.value : undefined;
    }
    return target;
  }
  var narrowedError = (name) => `Stale read from <${name}>.`;
  function For(props) {
    const fallback = "fallback" in props && {
      fallback: () => props.fallback
    };
    return createMemo(mapArray(() => props.each, props.children, fallback || undefined));
  }
  function Index(props) {
    const fallback = "fallback" in props && {
      fallback: () => props.fallback
    };
    return createMemo(indexArray(() => props.each, props.children, fallback || undefined));
  }
  function Show(props) {
    const keyed = props.keyed;
    const conditionValue = createMemo(() => props.when, undefined, undefined);
    const condition = keyed ? conditionValue : createMemo(conditionValue, undefined, {
      equals: (a, b) => !a === !b
    });
    return createMemo(() => {
      const c = condition();
      if (c) {
        const child = props.children;
        const fn = typeof child === "function" && child.length > 0;
        return fn ? untrack(() => child(keyed ? c : () => {
          if (!untrack(condition))
            throw narrowedError("Show");
          return conditionValue();
        })) : child;
      }
      return props.fallback;
    }, undefined, undefined);
  }

  // vendor/pocketjs/node_modules/solid-js/universal/dist/universal.js
  var memo = (fn) => createMemo(() => fn());
  function createRenderer$1({
    createElement,
    createTextNode,
    isTextNode,
    replaceText,
    insertNode,
    removeNode,
    setProperty,
    getParentNode,
    getFirstChild,
    getNextSibling
  }) {
    function insert(parent, accessor, marker, initial) {
      if (marker !== undefined && !initial)
        initial = [];
      if (typeof accessor !== "function")
        return insertExpression(parent, accessor, initial, marker);
      createRenderEffect((current) => insertExpression(parent, accessor(), current, marker), initial);
    }
    function insertExpression(parent, value, current, marker, unwrapArray) {
      while (typeof current === "function")
        current = current();
      if (value === current)
        return current;
      const t = typeof value, multi = marker !== undefined;
      if (t === "string" || t === "number") {
        if (t === "number")
          value = value.toString();
        if (multi) {
          let node = current[0];
          if (node && isTextNode(node)) {
            replaceText(node, value);
          } else
            node = createTextNode(value);
          current = cleanChildren(parent, current, marker, node);
        } else {
          if (current !== "" && typeof current === "string") {
            replaceText(getFirstChild(parent), current = value);
          } else {
            cleanChildren(parent, current, marker, createTextNode(value));
            current = value;
          }
        }
      } else if (value == null || t === "boolean") {
        current = cleanChildren(parent, current, marker);
      } else if (t === "function") {
        createRenderEffect(() => {
          let v = value();
          while (typeof v === "function")
            v = v();
          current = insertExpression(parent, v, current, marker);
        });
        return () => current;
      } else if (Array.isArray(value)) {
        const array = [];
        if (normalizeIncomingArray(array, value, unwrapArray)) {
          createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
          return () => current;
        }
        if (array.length === 0) {
          const replacement = cleanChildren(parent, current, marker);
          if (multi)
            return current = replacement;
        } else {
          if (Array.isArray(current)) {
            if (current.length === 0) {
              appendNodes(parent, array, marker);
            } else
              reconcileArrays(parent, current, array);
          } else if (current == null || current === "") {
            appendNodes(parent, array);
          } else {
            reconcileArrays(parent, multi && current || [getFirstChild(parent)], array);
          }
        }
        current = array;
      } else {
        if (Array.isArray(current)) {
          if (multi)
            return current = cleanChildren(parent, current, marker, value);
          cleanChildren(parent, current, null, value);
        } else if (current == null || current === "" || !getFirstChild(parent)) {
          insertNode(parent, value);
        } else
          replaceNode(parent, value, getFirstChild(parent));
        current = value;
      }
      return current;
    }
    function normalizeIncomingArray(normalized, array, unwrap) {
      let dynamic = false;
      for (let i = 0, len = array.length;i < len; i++) {
        let item = array[i], t;
        if (item == null || item === true || item === false)
          ;
        else if (Array.isArray(item)) {
          dynamic = normalizeIncomingArray(normalized, item) || dynamic;
        } else if ((t = typeof item) === "string" || t === "number") {
          normalized.push(createTextNode(item));
        } else if (t === "function") {
          if (unwrap) {
            while (typeof item === "function")
              item = item();
            dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item]) || dynamic;
          } else {
            normalized.push(item);
            dynamic = true;
          }
        } else
          normalized.push(item);
      }
      return dynamic;
    }
    function reconcileArrays(parentNode, a, b) {
      let bLength = b.length, aEnd = a.length, bEnd = bLength, aStart = 0, bStart = 0, after = getNextSibling(a[aEnd - 1]), map = null;
      while (aStart < aEnd || bStart < bEnd) {
        if (a[aStart] === b[bStart]) {
          aStart++;
          bStart++;
          continue;
        }
        while (a[aEnd - 1] === b[bEnd - 1]) {
          aEnd--;
          bEnd--;
        }
        if (aEnd === aStart) {
          const node = bEnd < bLength ? bStart ? getNextSibling(b[bStart - 1]) : b[bEnd - bStart] : after;
          while (bStart < bEnd)
            insertNode(parentNode, b[bStart++], node);
        } else if (bEnd === bStart) {
          while (aStart < aEnd) {
            if (!map || !map.has(a[aStart]))
              removeNode(parentNode, a[aStart]);
            aStart++;
          }
        } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
          const node = getNextSibling(a[--aEnd]);
          insertNode(parentNode, b[bStart++], getNextSibling(a[aStart++]));
          insertNode(parentNode, b[--bEnd], node);
          a[aEnd] = b[bEnd];
        } else {
          if (!map) {
            map = new Map;
            let i = bStart;
            while (i < bEnd)
              map.set(b[i], i++);
          }
          const index = map.get(a[aStart]);
          if (index != null) {
            if (bStart < index && index < bEnd) {
              let i = aStart, sequence = 1, t;
              while (++i < aEnd && i < bEnd) {
                if ((t = map.get(a[i])) == null || t !== index + sequence)
                  break;
                sequence++;
              }
              if (sequence > index - bStart) {
                const node = a[aStart];
                while (bStart < index)
                  insertNode(parentNode, b[bStart++], node);
              } else
                replaceNode(parentNode, b[bStart++], a[aStart++]);
            } else
              aStart++;
          } else
            removeNode(parentNode, a[aStart++]);
        }
      }
    }
    function cleanChildren(parent, current, marker, replacement) {
      if (marker === undefined) {
        let removed;
        while (removed = getFirstChild(parent))
          removeNode(parent, removed);
        replacement && insertNode(parent, replacement);
        return "";
      }
      const node = replacement || createTextNode("");
      if (current.length) {
        let inserted = false;
        for (let i = current.length - 1;i >= 0; i--) {
          const el = current[i];
          if (node !== el) {
            const isParent = getParentNode(el) === parent;
            if (!inserted && !i)
              isParent ? replaceNode(parent, node, el) : insertNode(parent, node, marker);
            else
              isParent && removeNode(parent, el);
          } else
            inserted = true;
        }
      } else
        insertNode(parent, node, marker);
      return [node];
    }
    function appendNodes(parent, array, marker) {
      for (let i = 0, len = array.length;i < len; i++)
        insertNode(parent, array[i], marker);
    }
    function replaceNode(parent, newNode, oldNode) {
      insertNode(parent, newNode, oldNode);
      removeNode(parent, oldNode);
    }
    function spreadExpression(node, props, prevProps = {}, skipChildren) {
      props || (props = {});
      if (!skipChildren) {
        createRenderEffect(() => prevProps.children = insertExpression(node, props.children, prevProps.children));
      }
      createRenderEffect(() => props.ref && props.ref(node));
      createRenderEffect(() => {
        for (const prop in props) {
          if (prop === "children" || prop === "ref")
            continue;
          const value = props[prop];
          if (value === prevProps[prop])
            continue;
          setProperty(node, prop, value, prevProps[prop]);
          prevProps[prop] = value;
        }
      });
      return prevProps;
    }
    return {
      render(code, element) {
        let disposer;
        createRoot((dispose) => {
          disposer = dispose;
          insert(element, code());
        });
        return disposer;
      },
      insert,
      spread(node, accessor, skipChildren) {
        if (typeof accessor === "function") {
          createRenderEffect((current) => spreadExpression(node, accessor(), current, skipChildren));
        } else
          spreadExpression(node, accessor, undefined, skipChildren);
      },
      createElement,
      createTextNode,
      insertNode,
      setProp(node, name, value, prev) {
        setProperty(node, name, value, prev);
        return value;
      },
      mergeProps,
      effect: createRenderEffect,
      memo,
      createComponent,
      use(fn, element, arg) {
        return untrack(() => fn(element, arg));
      }
    };
  }
  function createRenderer(options) {
    const renderer = createRenderer$1(options);
    renderer.mergeProps = mergeProps;
    return renderer;
  }

  // vendor/pocketjs/framework/src/solid-row.ts
  var RowContext = createContext();
  var nodeRows = new WeakMap;
  function captureNodeRow(node) {
    const row = useContext(RowContext);
    if (row)
      nodeRows.set(node, row);
  }
  function nodeRow(node) {
    return nodeRows.get(node);
  }
  function snapshotValue(value, copies = new Map) {
    if (!value || typeof value !== "object")
      return value;
    if (copies.has(value))
      return copies.get(value);
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      return value;
    const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
    copies.set(value, copy);
    for (const key of Object.keys(value))
      copy[key] = snapshotValue(value[key], copies);
    return copy;
  }
  function withRowSnapshot(row, invoke) {
    if (!row) {
      invoke();
      return;
    }
    const chain = [];
    for (let current = row;current; current = current.parent)
      chain.unshift(current);
    const previous = chain.map((context) => context.snapshot);
    try {
      for (const context of chain) {
        const resolved = context.resolve();
        if (!resolved)
          return;
        context.snapshot = {
          item: snapshotValue(resolved.item),
          index: resolved.index
        };
      }
      invoke();
    } finally {
      for (let i = 0;i < chain.length; i++)
        chain[i].snapshot = previous[i];
    }
  }

  // vendor/pocketjs/contracts/spec/binding-generation.ts
  var POCKET_BINDING_GENERATION = 12;

  // vendor/pocketjs/contracts/spec/spec.ts
  var SCREEN_W = 480;
  var SCREEN_H = 272;
  var NODE_TYPE = {
    view: 0,
    text: 1,
    image: 2,
    surface: 3
  };
  var ROOT_ID = 1;
  var STYLE_ID_NONE = -1;
  var PROP = {
    width: 1,
    height: 2,
    minW: 3,
    minH: 4,
    maxW: 5,
    maxH: 6,
    paddingT: 8,
    paddingR: 9,
    paddingB: 10,
    paddingL: 11,
    marginT: 12,
    marginR: 13,
    marginB: 14,
    marginL: 15,
    gap: 16,
    flexDir: 17,
    justify: 18,
    align: 19,
    grow: 20,
    shrink: 21,
    basis: 22,
    flexWrap: 23,
    posType: 24,
    insetT: 25,
    insetR: 26,
    insetB: 27,
    insetL: 28,
    display: 29,
    overflow: 30,
    zIndex: 31,
    hitPass: 32,
    contain: 33,
    bgColor: 64,
    gradFrom: 65,
    gradTo: 66,
    gradDir: 67,
    radius: 68,
    opacity: 69,
    borderColor: 70,
    borderWidth: 71,
    shadow: 72,
    bevelOuterLight: 77,
    bevelOuterDark: 78,
    bevelInnerLight: 79,
    bevelInnerDark: 80,
    bevelWidth: 81,
    gradVia: 82,
    gradViaPos: 83,
    textColor: 96,
    fontSlot: 97,
    textAlign: 98,
    lineHeight: 99,
    tracking: 100,
    translateX: 128,
    translateY: 129,
    scale: 130,
    rotate: 131,
    scaleX: 132,
    scaleY: 133,
    originX: 134,
    originY: 135,
    rotateX: 136,
    rotateY: 137,
    translateZ: 138,
    perspective: 139,
    arcStart: 140,
    arcSweep: 141,
    arcWidth: 142,
    skewX: 143
  };
  var ANIMATABLE = [
    "width",
    "height",
    "paddingT",
    "paddingR",
    "paddingB",
    "paddingL",
    "marginT",
    "marginR",
    "marginB",
    "marginL",
    "gap",
    "basis",
    "insetT",
    "insetR",
    "insetB",
    "insetL",
    "bgColor",
    "gradFrom",
    "gradTo",
    "radius",
    "opacity",
    "borderColor",
    "borderWidth",
    "textColor",
    "lineHeight",
    "tracking",
    "translateX",
    "translateY",
    "scale",
    "rotate",
    "scaleX",
    "scaleY",
    "rotateX",
    "rotateY",
    "translateZ",
    "arcStart",
    "arcSweep",
    "arcWidth",
    "skewX"
  ];
  function animBit(prop) {
    return ANIMATABLE.indexOf(prop);
  }
  var VALUE_KIND = {
    f32: 0,
    color: 1,
    int: 2
  };
  var PROP_VALUE_KIND = {
    width: VALUE_KIND.f32,
    height: VALUE_KIND.f32,
    minW: VALUE_KIND.f32,
    minH: VALUE_KIND.f32,
    maxW: VALUE_KIND.f32,
    maxH: VALUE_KIND.f32,
    paddingT: VALUE_KIND.f32,
    paddingR: VALUE_KIND.f32,
    paddingB: VALUE_KIND.f32,
    paddingL: VALUE_KIND.f32,
    marginT: VALUE_KIND.f32,
    marginR: VALUE_KIND.f32,
    marginB: VALUE_KIND.f32,
    marginL: VALUE_KIND.f32,
    gap: VALUE_KIND.f32,
    flexDir: VALUE_KIND.int,
    justify: VALUE_KIND.int,
    align: VALUE_KIND.int,
    grow: VALUE_KIND.f32,
    shrink: VALUE_KIND.f32,
    basis: VALUE_KIND.f32,
    flexWrap: VALUE_KIND.int,
    posType: VALUE_KIND.int,
    insetT: VALUE_KIND.f32,
    insetR: VALUE_KIND.f32,
    insetB: VALUE_KIND.f32,
    insetL: VALUE_KIND.f32,
    display: VALUE_KIND.int,
    overflow: VALUE_KIND.int,
    zIndex: VALUE_KIND.int,
    hitPass: VALUE_KIND.int,
    contain: VALUE_KIND.int,
    bgColor: VALUE_KIND.color,
    gradFrom: VALUE_KIND.color,
    gradTo: VALUE_KIND.color,
    gradDir: VALUE_KIND.int,
    radius: VALUE_KIND.f32,
    opacity: VALUE_KIND.f32,
    borderColor: VALUE_KIND.color,
    borderWidth: VALUE_KIND.f32,
    shadow: VALUE_KIND.int,
    bevelOuterLight: VALUE_KIND.color,
    bevelOuterDark: VALUE_KIND.color,
    bevelInnerLight: VALUE_KIND.color,
    bevelInnerDark: VALUE_KIND.color,
    bevelWidth: VALUE_KIND.f32,
    gradVia: VALUE_KIND.color,
    gradViaPos: VALUE_KIND.f32,
    textColor: VALUE_KIND.color,
    fontSlot: VALUE_KIND.int,
    textAlign: VALUE_KIND.int,
    lineHeight: VALUE_KIND.f32,
    tracking: VALUE_KIND.f32,
    translateX: VALUE_KIND.f32,
    translateY: VALUE_KIND.f32,
    scale: VALUE_KIND.f32,
    rotate: VALUE_KIND.f32,
    scaleX: VALUE_KIND.f32,
    scaleY: VALUE_KIND.f32,
    originX: VALUE_KIND.f32,
    originY: VALUE_KIND.f32,
    rotateX: VALUE_KIND.f32,
    rotateY: VALUE_KIND.f32,
    translateZ: VALUE_KIND.f32,
    perspective: VALUE_KIND.f32,
    arcStart: VALUE_KIND.f32,
    arcSweep: VALUE_KIND.f32,
    arcWidth: VALUE_KIND.f32,
    skewX: VALUE_KIND.f32
  };
  var ENUMS = {
    FlexDir: {
      Row: 0,
      Col: 1
    },
    Justify: {
      Start: 0,
      Center: 1,
      End: 2,
      Between: 3,
      Around: 4
    },
    Align: {
      Start: 0,
      Center: 1,
      End: 2,
      Stretch: 3
    },
    PosType: {
      Relative: 0,
      Absolute: 1
    },
    Display: {
      Flex: 0,
      None: 1
    },
    Overflow: {
      Visible: 0,
      Hidden: 1
    },
    Contain: {
      None: 0,
      Strict: 1,
      Baked: 2
    },
    TextAlign: {
      Left: 0,
      Center: 1,
      Right: 2
    },
    GradDir: {
      ToTop: 0,
      ToBottom: 1,
      ToLeft: 2,
      ToRight: 3
    },
    Easing: {
      Linear: 0,
      EaseIn: 1,
      EaseOut: 2,
      EaseInOut: 3,
      OutBack: 4,
      Spring: 5,
      SpringBouncy: 6,
      CubicBezier: 7
    }
  };
  var PSM = {
    PSM_5650: 0,
    PSM_4444: 2,
    PSM_8888: 3,
    PSM_T8: 5
  };
  var IMG_FLAG_RLE = 1 << 0;
  var IMG_FLAG_LINEAR = 1 << 1;
  var TILESET_FLAG_RLE = 1 << 0;
  var TILESET_FLAG_LINEAR = 1 << 1;
  var SVC_IMG_MAX_BYTES = 128 * 1024;
  var STREAM_FLAG_ENDED = 1 << 0;
  var WIRE_MAX_PAYLOAD = 256 * 1024;
  var WIRE_SLOT_FLAG_RLE = 1 << 0;
  var WIRE_MARK_FLAG_ENDED = 1 << 0;
  var STYLE_VARIANT_BASE = 1 << 0;
  var STYLE_VARIANT_FOCUS = 1 << 1;
  var STYLE_VARIANT_ACTIVE = 1 << 2;
  var STYLE_HAS_TRANSITION = 1 << 3;
  var STYLE_HAS_ANIMATION = 1 << 4;
  var ANIM_FILL_BACKWARDS = 1 << 0;
  var ANIM_FILL_FORWARDS = 1 << 1;
  function abgr(r, g, b, a = 255) {
    return ((a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | r & 255) >>> 0;
  }
  var FONT_FLAG_BOLD = 1 << 0;
  var PAK_MAGIC = 1263551300;
  var PAK_VERSION = 1;
  var PAK_HEADER_SIZE = 32;
  var PAK_ENTRY_SIZE = 24;
  var BTN = {
    SELECT: 1,
    START: 8,
    UP: 16,
    RIGHT: 32,
    DOWN: 64,
    LEFT: 128,
    LTRIGGER: 256,
    RTRIGGER: 512,
    ZL: 1024,
    ZR: 2048,
    TRIANGLE: 4096,
    CIRCLE: 8192,
    CROSS: 16384,
    SQUARE: 32768
  };
  var ANALOG_CENTER = 32896;
  var FIXED_DT = 1 / 60;

  // vendor/pocketjs/framework/src/host.ts
  function hostViewport(ops) {
    return ops.__viewport ?? null;
  }
  var current = null;
  function embeddedBuildHostContract() {
    const target = "rg-ds-plus";
    const hostAbi = 12;
    if (hostAbi !== POCKET_BINDING_GENERATION)
      throw new Error(`PocketJS: bundle binding generation ${hostAbi} is unsupported; rebuild for ${POCKET_BINDING_GENERATION}`);
    return target ? {
      target,
      hostAbi
    } : null;
  }
  function assertNativeHostContract(ops, expected = embeddedBuildHostContract()) {
    const baked = 60;
    const declared = ops.__tickHz ?? 60;
    if (declared !== baked) {
      throw new Error(ops.__tickHz === undefined ? `PocketJS: this bundle bakes ${baked} Hz virtual time but the host declares no ui.__tickHz, ` + "which means the 60 Hz default — declare the rate before mount and drive the surface at it " + "(pocket_apple set_tick_rate before eval_bundle; PocketSurfaceView.tickRate)" : `PocketJS: tick-rate mismatch (bundle baked at ${baked} Hz, host drives ${declared} Hz) — ` + "a bundle only runs correctly at the rate it was built with (`--hz`), like glyphs at their density");
    }
    if (expected && expected.hostAbi !== POCKET_BINDING_GENERATION) {
      throw new Error(`PocketJS: native host ABI mismatch (bundle binding generation ${expected.hostAbi} is unsupported; rebuild for ${POCKET_BINDING_GENERATION})`);
    }
    if (ops.__hostAbi !== POCKET_BINDING_GENERATION) {
      throw new Error(`PocketJS: native host ABI mismatch (bundle=${POCKET_BINDING_GENERATION}, host=${ops.__hostAbi ?? "missing"}); rebuild the native host`);
    }
    if (!expected)
      return;
    if (typeof ops.__host !== "string") {
      throw new Error(`PocketJS: this bundle targets "${expected.target}" but the native host predates platform ` + "contracts — add __host/__hostAbi to its ui namespace (see framework/src/host.ts HostOps)");
    }
  }
  function detectHost(injected) {
    const native = globalThis.ui;
    const nativeMarked = native !== undefined && (typeof native.__host === "string" || native.__textures !== undefined);
    if (injected) {
      if (native !== undefined && injected === native && nativeMarked) {
        assertNativeHostContract(native);
        return {
          ops: injected,
          kind: "native",
          target: native.__host ?? "unknown",
          strict: false
        };
      }
      return {
        ops: injected,
        kind: "injected",
        target: injected.__host ?? "injected",
        strict: true
      };
    }
    if (native !== undefined && nativeMarked) {
      assertNativeHostContract(native);
      return {
        ops: native,
        kind: "native",
        target: native.__host ?? "unknown",
        strict: false
      };
    }
    if (native) {
      return {
        ops: native,
        kind: "injected",
        target: "injected",
        strict: true
      };
    }
    throw new Error("PocketJS: no host — pass HostOps to render() (web/test) or run under a native runtime (globalThis.ui)");
  }
  function installHost(host) {
    current = host;
  }
  function getHost() {
    if (!current) {
      throw new Error("PocketJS: host not installed — call render() first");
    }
    return current;
  }
  function getOps() {
    return getHost().ops;
  }
  function installFrameHandler(fn) {
    globalThis.frame = fn;
  }
  function installResizeViewportHook(resizeViewport) {
    const globals = globalThis;
    const previous = globals.__pocketResizeViewport;
    const hook = (width, height) => resizeViewport(width, height);
    globals.__pocketResizeViewport = hook;
    return () => {
      if (globals.__pocketResizeViewport !== hook)
        return;
      if (previous)
        globals.__pocketResizeViewport = previous;
      else
        delete globals.__pocketResizeViewport;
    };
  }
  function parseHexColor(s) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = [...hex].map((character) => character + character).join("");
    }
    if (hex.length !== 6 && hex.length !== 8) {
      throw new Error(`PocketJS: bad color '${s}' (expected #rgb/#rgba/#rrggbb/#rrggbbaa)`);
    }
    if (!/^[0-9a-fA-F]+$/.test(hex))
      throw new Error(`PocketJS: bad color '${s}'`);
    const n = parseInt(hex, 16);
    if (hex.length === 6) {
      return abgr(n >>> 16 & 255, n >>> 8 & 255, n & 255, 255);
    }
    return abgr(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
  }
  function encodePropValue(prop, value) {
    const kind = PROP_VALUE_KIND[prop];
    if (typeof value === "string") {
      if (kind === VALUE_KIND.color)
        return parseHexColor(value);
      const n = Number(value);
      if (Number.isNaN(n)) {
        throw new Error(`PocketJS: non-numeric value '${value}' for prop '${prop}'`);
      }
      value = n;
    }
    if (kind === VALUE_KIND.color || kind === VALUE_KIND.int)
      return value >>> 0;
    return value;
  }

  // vendor/pocketjs/framework/src/clock.ts
  var TICKS_PER_SECOND = validTickHz(60);
  function validTickHz(hz) {
    if (!Number.isInteger(hz) || hz < 1 || hz > 240) {
      throw new Error(`PocketJS: __POCKET_TICK_HZ__ must be an integer from 1 through 240, got ${hz}`);
    }
    return hz;
  }
  var VALID_HZ = divisorsOf(TICKS_PER_SECOND);
  function divisorsOf(n) {
    const out = [];
    for (let d = 1;d <= n; d++) {
      if (n % d === 0)
        out.push(d);
    }
    return out;
  }
  var hz = TICKS_PER_SECOND;
  var frame = -1;
  var timerSeq = 0;
  var timers = [];
  var nextDue = Infinity;
  function normalizeHz(raw) {
    if (!Number.isFinite(raw) || raw <= 0)
      return TICKS_PER_SECOND;
    let best = VALID_HZ[0];
    for (const v of VALID_HZ) {
      if (Math.abs(v - raw) < Math.abs(best - raw))
        best = v;
    }
    return best;
  }
  function simulationHz() {
    return hz;
  }
  function ticksPerFrame() {
    return TICKS_PER_SECOND / hz;
  }
  function virtualFrame() {
    return frame < 0 ? 0 : frame;
  }
  function virtualNow() {
    return virtualFrame() / hz;
  }
  function after(seconds, cb) {
    const t = {
      at: virtualFrame() + Math.max(1, Math.round(seconds * hz)),
      seq: timerSeq++,
      cb
    };
    timers.push(t);
    if (t.at < nextDue)
      nextDue = t.at;
    return () => {
      const i = timers.indexOf(t);
      if (i >= 0)
        timers.splice(i, 1);
    };
  }
  function resetClock() {
    const raw = globalThis.__simHz;
    hz = typeof raw === "number" ? normalizeHz(raw) : TICKS_PER_SECOND;
    frame = -1;
    timers = [];
    nextDue = Infinity;
    timerSeq = 0;
  }
  function __advanceClock() {
    frame = frame < 0 ? 0 : frame + 1;
    if (timers.length === 0 || frame < nextDue)
      return;
    const due = timers.filter((t) => t.at <= frame).sort((a, b) => a.at - b.at || a.seq - b.seq);
    if (due.length > 0)
      timers = timers.filter((t) => t.at > frame);
    nextDue = Infinity;
    for (const t of timers)
      if (t.at < nextDue)
        nextDue = t.at;
    for (const t of due)
      t.cb();
  }

  // vendor/pocketjs/framework/src/analog.ts
  var ANALOG_DEADZONE = 0.12;
  var analogPacked = ANALOG_CENTER;
  var rightPacked = ANALOG_CENTER;
  function __setAnalog(packed, right = undefined) {
    analogPacked = packed === undefined ? ANALOG_CENTER : packed & 65535;
    rightPacked = right === undefined ? ANALOG_CENTER : right & 65535;
  }
  function __resetAnalog() {
    analogPacked = rightPacked = ANALOG_CENTER;
  }
  function axis(raw) {
    const value = Math.max(-1, Math.min(1, (raw - 128) / 127));
    const magnitude = Math.abs(value);
    if (magnitude < ANALOG_DEADZONE)
      return 0;
    return Math.sign(value) * (magnitude - ANALOG_DEADZONE) / (1 - ANALOG_DEADZONE);
  }
  function analogX() {
    return axis(analogPacked >> 8 & 255);
  }
  function analogY() {
    return axis(analogPacked & 255);
  }
  function rightAnalogX() {
    return axis(rightPacked >> 8 & 255);
  }
  function rightAnalogY() {
    return axis(rightPacked & 255);
  }

  // vendor/pocketjs/contracts/spec/motion.ts
  var MotionLevel = {
    Gravity: 1,
    Inertial: 2,
    Geomagnetic: 3
  };
  var MOTION_LEVELS = {
    gravity: MotionLevel.Gravity,
    inertial: MotionLevel.Inertial,
    geomagnetic: MotionLevel.Geomagnetic
  };
  var MotionQuality = {
    Unavailable: 0,
    Unreliable: 1,
    Low: 2,
    Medium: 3,
    High: 4
  };
  var MOTION_MIN_QUALITIES = {
    unreliable: MotionQuality.Unreliable,
    low: MotionQuality.Low,
    medium: MotionQuality.Medium,
    high: MotionQuality.High
  };
  var MotionReferenceFrame = {
    Device: 0,
    Local: 1,
    MagneticNorth: 2,
    TrueNorth: 3
  };
  var MOTION_VALUES = {
    gravityDirection: {
      id: 0,
      level: "gravity",
      components: ["x", "y", "z"],
      metadata: ["quality", "timestamp"]
    },
    inclination: {
      id: 1,
      level: "gravity",
      components: ["degrees"],
      metadata: ["quality", "timestamp"]
    },
    linearAcceleration: {
      id: 2,
      level: "inertial",
      components: ["x", "y", "z"],
      metadata: ["quality", "timestamp"]
    },
    rotationRate: {
      id: 3,
      level: "inertial",
      components: ["x", "y", "z"],
      metadata: ["quality", "timestamp"]
    },
    orientation: {
      id: 4,
      level: "inertial",
      components: ["w", "x", "y", "z"],
      metadata: ["quality", "referenceFrame", "epoch", "timestamp"]
    },
    heading: {
      id: 5,
      level: "geomagnetic",
      components: ["degrees", "accuracy"],
      metadata: ["quality", "referenceFrame", "timestamp"]
    },
    screenRotation: {
      id: 6,
      level: "gravity",
      derivedFrom: "gravityDirection",
      components: ["degrees"],
      metadata: ["quality", "timestamp"]
    },
    tilt: {
      id: 7,
      level: "gravity",
      derivedFrom: "gravityDirection",
      components: ["beta", "gamma"],
      metadata: ["quality", "timestamp"]
    },
    angles: {
      id: 8,
      level: "inertial",
      derivedFrom: "orientation",
      components: ["alpha", "beta", "gamma"],
      metadata: ["quality", "referenceFrame", "epoch", "timestamp"]
    }
  };

  // vendor/pocketjs/contracts/spec/microts.ts
  var MICROTS_NUMERIC_TYPES = ["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "usize", "f32", "f64"];
  var RelativeAxis = {
    Primary: 0,
    Secondary: 1
  };
  var RelativeAxisUnits = {
    PerDegree: 1000,
    PerTurn: 360000
  };
  var MICROTS_RELATIVE_AXES = {
    primary: RelativeAxis.Primary,
    secondary: RelativeAxis.Secondary
  };
  var pixelProps = new Set(["width", "height", "minW", "minH", "maxW", "maxH", "paddingT", "paddingR", "paddingB", "paddingL", "marginT", "marginR", "marginB", "marginL", "gap", "basis", "insetT", "insetR", "insetB", "insetL", "radius", "borderWidth", "bevelWidth", "lineHeight", "tracking", "translateX", "translateY", "translateZ", "perspective", "arcWidth"]);
  var degreeProps = new Set(["rotate", "rotateX", "rotateY", "arcStart", "arcSweep", "skewX"]);
  var MICROTS_ELEMENTS = {
    View: {
      nodeType: NODE_TYPE.view,
      attributes: ["class", "style", "focusable", "debug-name"],
      events: ["press"]
    },
    Text: {
      nodeType: NODE_TYPE.text,
      attributes: ["class"],
      events: []
    },
    Image: {
      nodeType: NODE_TYPE.image,
      attributes: ["class", "src"],
      events: []
    }
  };
  var MICROTS_STYLE_PROPS = Object.fromEntries(Object.entries(PROP).map(([name, id]) => {
    const kind = PROP_VALUE_KIND[name];
    const unit = kind === VALUE_KIND.color ? "Color" : pixelProps.has(name) ? "Px" : degreeProps.has(name) ? "Deg" : undefined;
    return [name, {
      id,
      type: kind === VALUE_KIND.f32 ? "f32" : kind === VALUE_KIND.color ? "u32" : "i32",
      ...unit ? {
        unit
      } : {}
    }];
  }));
  var MICROTS_MATH_BUILTINS = ["sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "exp", "log"];
  var MICROTS_MATH2_BUILTINS = ["atan2", "pow", "hypot"];
  var MICROTS_EXTENDED_BUILTINS = {
    ...Object.fromEntries(MICROTS_NUMERIC_TYPES.map((name) => [name, `export declare function ${name}(value: number): N.${name};`])),
    ...Object.fromEntries(MICROTS_MATH_BUILTINS.map((name) => [name, `export declare function ${name}<T extends N.f32 | N.f64>(value: T): T;`])),
    ...Object.fromEntries(MICROTS_MATH2_BUILTINS.map((name) => [name, `export declare function ${name}<T extends N.f32 | N.f64>(value: T, other: NoInfer<T> | MicroTsPlainNumber): T;`])),
    fill: "export declare function fill<T>(count: N.i32, value: T): T[];",
    push: "export declare function push<T>(target: T[], value: T): void;",
    pop: "export declare function pop<T>(target: T[]): T;",
    insert: "export declare function insert<T>(target: T[], index: N.i32, value: T): void;",
    removeAt: "export declare function removeAt<T>(target: T[], index: N.i32): T;",
    clear: "export declare function clear<T>(target: T[]): void;",
    truncate: "export declare function truncate<T>(target: T[], length: N.i32): void;",
    fillRange: "export declare function fillRange<T>(target: T[], start: N.i32, end: N.i32, value: T): void;",
    copyRange: "export declare function copyRange<T>(target: T[], targetStart: N.i32, source: readonly T[], sourceStart: N.i32, count: N.i32, skip?: T): void;",
    fillRect: "export declare function fillRect<T>(target: T[], start: N.i32, stride: N.i32, width: N.i32, height: N.i32, value: T): void;",
    copyRect: "export declare function copyRect<T>(target: T[], targetStart: N.i32, targetStride: N.i32, source: readonly T[], sourceStart: N.i32, sourceStride: N.i32, width: N.i32, height: N.i32, skip?: T): void;",
    codePoints: "export declare function codePoints(value: string): N.i32[];",
    fromCodePoint: "export declare function fromCodePoint(code: N.i32): string;",
    embedBytes: "export declare function embedBytes(path: string): N.u8[];"
  };

  // vendor/pocketjs/framework/src/relative-axis.ts
  var pending = [0, 0];
  var current2 = [0, 0];
  var EMPTY_AXIS_DELTAS = Object.freeze([]);
  function validate(axis, delta) {
    if (axis !== RelativeAxis.Primary && axis !== RelativeAxis.Secondary)
      throw new Error(`Unknown relative axis ${axis}`);
    if (!Number.isInteger(delta) || delta < -2147483648 || delta > 2147483647)
      throw new Error("Relative-axis deltas must be signed i32 millidegrees");
  }
  function sum(a, b) {
    return Math.min(2147483647, Math.max(-2147483648, a + b));
  }
  function __takeAxisDeltas(deltas) {
    if (deltas !== undefined) {
      for (const {
        axis,
        delta
      } of deltas)
        validate(axis, delta);
      pending[0] = pending[1] = 0;
      return deltas;
    }
    const result = pending.some((delta) => delta !== 0) ? pending.flatMap((delta, axis) => delta === 0 ? [] : [{
      axis,
      delta
    }]) : EMPTY_AXIS_DELTAS;
    pending[0] = pending[1] = 0;
    return result;
  }
  function __beginAxisFrame(deltas) {
    current2[0] = current2[1] = 0;
    for (const {
      axis,
      delta
    } of __takeAxisDeltas(deltas)) {
      current2[axis] = sum(current2[axis], delta);
    }
  }
  function __endAxisFrame() {
    current2[0] = current2[1] = 0;
  }
  function __resetAxisInput() {
    pending[0] = pending[1] = current2[0] = current2[1] = 0;
  }

  // vendor/pocketjs/framework/src/motion.ts
  var pending2 = null;
  var current3 = null;
  var QUALITIES = Object.values(MotionQuality);
  var FRAMES = Object.values(MotionReferenceFrame);
  function fail(member, rule) {
    throw new Error(`Motion state ${member} must be ${rule}`);
  }
  function f32(value, member) {
    const rounded = typeof value === "number" ? Math.fround(value) + 0 : NaN;
    return Number.isFinite(rounded) ? rounded : fail(member, "a finite f32");
  }
  function quality(value, member) {
    return QUALITIES.includes(value) ? value + 0 : fail(`${member}.quality`, `a MotionQuality id (${QUALITIES.join(", ")})`);
  }
  function referenceFrame(value, member) {
    return FRAMES.includes(value) ? value + 0 : fail(`${member}.referenceFrame`, `a MotionReferenceFrame id (${FRAMES.join(", ")})`);
  }
  function epoch(value, member) {
    return Number.isInteger(value) && value >= 0 && value <= 4294967295 ? value + 0 : fail(`${member}.epoch`, "a u32");
  }
  function components(value, member, length) {
    if (!Array.isArray(value) || value.length !== length)
      fail(`${member}.value`, `${length} numbers`);
    return Array.from(value, (component, index) => f32(component, `${member}.value[${index}]`));
  }
  function estimate(state, member) {
    const value = state[member];
    if (value == null)
      return;
    return typeof value === "object" ? value : fail(member, "an estimate object");
  }
  function __copyMotionState(state) {
    if (state === null || typeof state !== "object")
      throw new Error("A motion state must be an object");
    if (!Number.isSafeInteger(state.timestamp) || state.timestamp < 0)
      fail("timestamp", "non-negative integer microseconds");
    const out = {
      timestamp: state.timestamp + 0
    };
    for (const member of ["gravityDirection", "linearAcceleration", "rotationRate"]) {
      const value = estimate(state, member);
      if (value)
        out[member] = {
          value: components(value.value, member, 3),
          quality: quality(value.quality, member)
        };
    }
    for (const member of ["inclination", "screenRotation"]) {
      const value = estimate(state, member);
      if (value)
        out[member] = {
          value: f32(value.value, `${member}.value`),
          quality: quality(value.quality, member)
        };
    }
    const tilt = estimate(state, "tilt");
    if (tilt)
      out.tilt = {
        value: components(tilt.value, "tilt", 2),
        quality: quality(tilt.quality, "tilt")
      };
    const orientation = estimate(state, "orientation");
    if (orientation) {
      out.orientation = {
        value: components(orientation.value, "orientation", 4),
        quality: quality(orientation.quality, "orientation"),
        referenceFrame: referenceFrame(orientation.referenceFrame, "orientation"),
        epoch: epoch(orientation.epoch, "orientation")
      };
    }
    const angles = estimate(state, "angles");
    if (angles) {
      out.angles = {
        value: components(angles.value, "angles", 3),
        quality: quality(angles.quality, "angles"),
        referenceFrame: referenceFrame(angles.referenceFrame, "angles"),
        epoch: epoch(angles.epoch, "angles")
      };
    }
    const heading = estimate(state, "heading");
    if (heading)
      out.heading = {
        value: f32(heading.value, "heading.value"),
        accuracy: f32(heading.accuracy, "heading.accuracy"),
        quality: quality(heading.quality, "heading"),
        referenceFrame: referenceFrame(heading.referenceFrame, "heading")
      };
    return out;
  }
  function __takeMotionState(state) {
    const result = state === undefined ? pending2 : state === null ? null : __copyMotionState(state);
    pending2 = null;
    return result;
  }
  function __beginMotionFrame(state) {
    current3 = __takeMotionState(state);
  }
  function __endMotionFrame() {
    current3 = null;
  }
  function __resetMotionInput() {
    pending2 = current3 = null;
  }

  // vendor/pocketjs/framework/src/frame-dispatch.ts
  class FrameRegistry {
    callbacks = new Set;
    placed = new Map;
    snapshot = null;
    add(callback, placement) {
      if (placement)
        this.placed.set(callback, placement);
      else
        this.callbacks.add(callback);
      this.snapshot = null;
      return () => {
        const removed = this.callbacks.delete(callback);
        if (this.placed.delete(callback) || removed)
          this.snapshot = null;
      };
    }
    clear() {
      this.callbacks.clear();
      this.placed.clear();
      this.snapshot = null;
    }
    freeze() {
      return this.snapshot ??= {
        callbacks: [...this.callbacks],
        placed: [...this.placed]
      };
    }
  }
  function dispatchFrame(frame, buttons, run, beforeHooks, resolveInput) {
    let pending;
    const enqueue = (node, invoke) => {
      pending ??= new Map;
      const entries = pending.get(node);
      if (entries)
        entries.push(invoke);
      else
        pending.set(node, [invoke]);
    };
    beforeHooks?.(enqueue);
    for (let i = 0;i < frame.callbacks.length; i++)
      frame.callbacks[i](buttons);
    for (let i = 0;i < frame.placed.length; i++) {
      const [callback, node] = frame.placed[i];
      enqueue(node, () => callback(buttons));
    }
    resolveInput?.(enqueue);
    if (!pending)
      return;
    const queued = pending;
    const roots = new Set;
    for (const node of queued.keys()) {
      if (!node.isConnected)
        continue;
      let root = node;
      while (root.parent)
        root = root.parent;
      roots.add(root);
    }
    const ordered = [];
    const collect = (node) => {
      const entries = queued.get(node);
      if (entries)
        for (const invoke of entries)
          ordered.push([node, invoke]);
      for (const child of node.children)
        collect(child);
    };
    for (const root of roots)
      collect(root);
    for (const [node, invoke] of ordered)
      run(node, invoke);
  }

  // vendor/pocketjs/framework/src/aot-lifecycle.ts
  function createLifecycleScheduler(batch, update = () => {}) {
    const hooks = new Set;
    let sequence = 0;
    let running = false;
    let dirty = false;
    const dead = () => [...hooks].filter((hook) => hook.destroyed).sort((a, b) => b.sequence - a.sequence);
    const destroy = (entries) => {
      for (const hook of entries) {
        hooks.delete(hook);
        hook.unmount?.();
      }
    };
    return {
      register(callback, phase) {
        const hook = {
          sequence: sequence++,
          [phase]: callback,
          destroyed: false,
          mounted: false
        };
        hooks.add(hook);
        dirty = true;
        return () => {
          hook.destroyed = true;
          dirty = true;
        };
      },
      flush() {
        if (running)
          return;
        running = true;
        try {
          update();
          for (let round = 0;; round++) {
            if (!dirty)
              return;
            dirty = false;
            const removed = dead();
            const added = [...hooks].filter((hook) => !hook.destroyed && !hook.mounted).sort((a, b) => a.sequence - b.sequence);
            if (removed.length === 0 && added.length === 0)
              return;
            const ranHooks = removed.some((hook) => hook.unmount) || added.some((hook) => hook.mount);
            if (ranHooks && round >= 8)
              throw new Error("PocketJS: AOT lifecycle exceeded eight hook rounds in one frame");
            batch(() => {
              destroy(removed);
              for (const hook of added) {
                hook.mounted = true;
                hook.mount?.();
              }
            });
            if (!ranHooks)
              return;
            update();
          }
        } catch (error) {
          dirty = true;
          throw error;
        } finally {
          running = false;
        }
      },
      flushUnmounted() {
        batch(() => destroy(dead()));
      },
      reset() {
        hooks.clear();
        sequence = 0;
        running = false;
        dirty = false;
      }
    };
  }

  // vendor/pocketjs/framework/src/model-reactive.ts
  var copy = (value) => {
    if (Array.isArray(value))
      return value.map(copy);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]));
    return value;
  };
  var regions = new Set;
  function reactModelRegions() {
    for (const region of regions) {
      if (region.disposed) {
        regions.delete(region);
        continue;
      }
      if (!region.initial && region.dirty) {
        region.react();
        region.settle();
      }
    }
  }

  // vendor/pocketjs/framework/src/model-tasks.ts
  var services = new Map;
  var deliveries = [];
  function deliverModelResult(request, value) {
    deliveries.push({
      request,
      value
    });
  }
  var key = (r) => `${r.task.region}:${r.task.function}:${r.task.call}:${r.wait}:${r.member}`;
  var taskRuntimes = new Set;
  var lastBoundary;
  var pendingRequests = new Map;
  var commands = [];
  var commandHandler;
  function registerModelCommandHandler(handler) {
    const previous = commandHandler;
    commandHandler = handler;
    return () => {
      if (commandHandler === handler)
        commandHandler = previous;
    };
  }
  function drainModelCommands() {
    const queue = commands;
    commands = [];
    for (const command of queue)
      command();
  }
  function resetModelTaskClock() {
    lastBoundary = undefined;
    for (const runtime of taskRuntimes)
      runtime.resetClock();
  }
  function disposeModelTasks(region) {
    for (const runtime of taskRuntimes)
      if (runtime.region === region)
        runtime.dispose();
  }
  function resumeModelTasks(frame = virtualFrame() + 1, now = virtualNow() * 1000) {
    lastBoundary = {
      frame,
      now
    };
    if (taskRuntimes.size === 0 && deliveries.length === 0)
      return;
    const incoming = deliveries;
    deliveries = [];
    const values = new Map;
    for (const item of incoming) {
      const pending = pendingRequests.get(key(item.request));
      if (pending && pending.task.status === "live" && !pending.runtime.region.disposed) {
        const source = pending.wait.source;
        const value = source.kind === "service" && !services.get(source.service)?.validate(item.value) ? {
          kind: "malformed"
        } : copy(item.value);
        pending.wait.ready = true;
        pending.wait.result = value;
        pending.wait.delivered = true;
        values.set(key(item.request), value);
        pending.runtime.region.emit("delivery", {
          request: item.request,
          value
        });
      } else
        ([...taskRuntimes].find((runtime) => runtime.region.instance === item.request.task.region) ?? taskRuntimes.values().next().value)?.region.emit("delivery-drop", {
          request: item.request
        });
    }
    const ready = [...taskRuntimes].sort((a, b) => a.region.instance - b.region.instance).flatMap((runtime) => runtime.snapshot(frame, now, values));
    for (const run of ready)
      run();
  }

  // vendor/pocketjs/framework/src/lifecycle-solid-aot.ts
  var scheduler = createLifecycleScheduler((run) => batch(() => {
    run();
    reactModelRegions();
  }));
  var roots = new WeakSet;
  var models = new Map;
  function registerModelLifecycle(region, root = false) {
    const mount = scheduler.register(() => {
      if (!region.disposed && region.initial) {
        region.react(true);
        region.settle();
      }
    }, "mount");
    const unmount = scheduler.register(() => {
      region.dispose();
      disposeModelTasks(region);
      models.delete(region);
    }, "unmount");
    const dispose = () => {
      mount();
      unmount();
    };
    models.set(region, {
      root,
      dispose
    });
    return dispose;
  }
  function disposeRootModelRegions() {
    for (const entry of models.values())
      if (entry.root)
        entry.dispose();
  }
  function flushLifecycleHooks() {
    scheduler.flush();
    drainModelCommands();
  }
  function flushUnmountedHooks() {
    scheduler.flushUnmounted();
    drainModelCommands();
  }
  function resetLifecycleHooks() {
    scheduler.reset();
    roots = new WeakSet;
    for (const [region, entry] of [...models])
      if (!region.disposed && region.initial)
        registerModelLifecycle(region, entry.root);
  }

  // vendor/pocketjs/contracts/spec/platform-types.ts
  function defineCapabilityRegistry(registry) {
    return registry;
  }
  var ANIMATION_CLASSES = ["composited", "repaint", "still"];
  var POCKET_CAPABILITIES = defineCapabilityRegistry([
    "runtime.worker",
    "io.i2c",
    "io.uart",
    "input.analog.left",
    "input.analog.right",
    "input.buttons",
    "input.cursor",
    "input.ime",
    "input.pointer",
    "input.text",
    "input.touch",
    "input.touch.auxiliary",
    "ui.compositor-surfaces",
    "ui.physics",
    "audio.pcm",
    "audio.capture",
    "media.playback",
    "io.offload",
    "net.http",
    "net.mqtt",
    "link.companion",
    "system.wifi",
    "system.device",
    "camera.qr",
    "camera.photo",
    "system.agent",
    "system.extension",
    "data.fs",
    "data.pack",
    "host.clipboard",
    "display.viewport.live",
    "display.auxiliary",
    "text.glyphs.baked",
    "text.glyphs.streamed",
    "text.glyphs.runtime",
    "text.layout.native",
    "text.layout.offload"
  ]);

  // vendor/pocketjs/framework/src/anim.ts
  var animationClass = ANIMATION_CLASSES.includes("composited") ? "composited" : "composited";
  var EASING_BY_NAME = {
    linear: ENUMS.Easing.Linear,
    in: ENUMS.Easing.EaseIn,
    out: ENUMS.Easing.EaseOut,
    "in-out": ENUMS.Easing.EaseInOut,
    "out-back": ENUMS.Easing.OutBack,
    spring: ENUMS.Easing.Spring,
    "spring-bouncy": ENUMS.Easing.SpringBouncy
  };
  function nodeId(node) {
    return typeof node === "number" ? node : node.id;
  }
  function animatablePropId(prop) {
    const propId = PROP[prop];
    if (propId === undefined) {
      throw new Error(`PocketJS: unknown prop '${prop}'`);
    }
    if (animBit(prop) < 0) {
      throw new Error(`PocketJS: prop '${prop}' is not animatable (see spec ANIMATABLE)`);
    }
    return propId;
  }
  function animate(node, prop, to, opts = {}) {
    if (typeof node === "function" && node.__pocketNodeRef)
      throw new Error("NodeSlot animation requires the compiled model transform");
    const propId = animatablePropId(prop);
    if (animationClass === "still") {
      getOps().setProp(nodeId(node), propId, encodePropValue(prop, to));
      return 0;
    }
    let easing;
    if (typeof opts.easing === "number") {
      easing = opts.easing;
    } else {
      const named = EASING_BY_NAME[opts.easing ?? "out"];
      if (named === undefined) {
        throw new Error(`PocketJS: unknown easing '${opts.easing}'`);
      }
      easing = named;
    }
    return getOps().animate(nodeId(node), propId, encodePropValue(prop, to), opts.dur ?? 200, easing, opts.delay ?? 0);
  }
  function jump(node, prop, value) {
    if (typeof node === "function" && node.__pocketNodeRef)
      throw new Error("NodeSlot jump requires the compiled model transform");
    getOps().setProp(nodeId(node), animatablePropId(prop), encodePropValue(prop, value));
  }

  // vendor/pocketjs/framework/src/model-node-ref.ts
  var references = new WeakMap;
  function clearNodeReferences(node) {
    for (const child of node.children)
      clearNodeReferences(child);
    for (const slot of references.get(node) ?? [])
      slot.current = null;
    references.delete(node);
  }

  // vendor/pocketjs/framework/src/model-animation.ts
  var pending3 = new Map;
  function installModelAnimationCommands() {
    registerModelCommandHandler((region, op, args, request) => {
      if (op === "log") {
        console.log(...args);
        return;
      }
      if (op !== "animate" && op !== "jump")
        throw new Error(`Unknown model command ${op}`);
      const slot = region.refs.get(String(args[0]));
      const node = slot?.current;
      if (!node) {
        if (request)
          deliverModelResult(request, "dropped");
        return;
      }
      if (op === "jump") {
        jump(node, args[1], args[2]);
        return;
      }
      if (request && !getOps().takeAnimationCompletions)
        throw new Error("Host lacks model animation completions; rebuild the host with Model AOT support");
      const id = animate(node, args[1], args[2], args[3]);
      if (request) {
        if (id < 0)
          deliverModelResult(request, "dropped");
        else
          pending3.set(id, request);
        return () => {
          pending3.delete(id);
        };
      }
    });
  }
  installModelAnimationCommands();
  function pollModelAnimations() {
    if (!pending3.size)
      return;
    const raw = getOps().takeAnimationCompletions?.();
    if (!raw)
      return;
    const completions = JSON.parse(raw);
    for (const [id, reason] of completions) {
      const request = pending3.get(id);
      if (!request)
        continue;
      pending3.delete(id);
      deliverModelResult(request, reason === 0 ? "ended" : reason === 1 ? "replaced" : "dropped");
    }
  }

  // vendor/pocketjs/framework/src/frame.ts
  var registry = new FrameRegistry;
  var systemRegistry = new FrameRegistry;
  var appSuspended = false;
  var merged = null;
  var NO_FRAME = {
    callbacks: [],
    placed: []
  };
  var buttonHandlerBlockDepth = 0;
  var SystemFrameContext = createContext(false);
  function frameSnapshot() {
    const app = appSuspended ? NO_FRAME : registry.freeze();
    const system = systemRegistry.freeze();
    if (system.callbacks.length === 0 && system.placed.length === 0)
      return app;
    if (merged?.app !== app || merged.system !== system) {
      merged = {
        app,
        system,
        frame: {
          callbacks: [...app.callbacks, ...system.callbacks],
          placed: [...app.placed, ...system.placed]
        }
      };
    }
    return merged.frame;
  }
  var runInRow = (node, invoke) => withRowSnapshot(nodeRow(node), invoke);
  function resetFrameHooks() {
    resetModelTaskClock();
    registry.clear();
    systemRegistry.clear();
    appSuspended = false;
    merged = null;
    buttonHandlerBlockDepth = 0;
    __resetAnalog();
    __resetAxisInput();
    __resetMotionInput();
    resetLifecycleHooks();
  }
  function runFrameHooks(buttons, axisDeltas, resolveInput, beforeHooks, motion) {
    __beginAxisFrame(axisDeltas);
    try {
      __beginMotionFrame(motion);
      const frame = frameSnapshot();
      batch(() => {
        pollModelAnimations();
        resumeModelTasks();
        dispatchFrame(frame, buttons, runInRow, beforeHooks, resolveInput);
        reactModelRegions();
      });
      flushLifecycleHooks();
    } finally {
      __endAxisFrame();
      __endMotionFrame();
    }
  }
  function registerFrame(callback, placement) {
    const row = useContext(RowContext);
    const target = useContext(SystemFrameContext) ? systemRegistry : registry;
    const wrapped = placement ? callback : row ? (buttons) => withRowSnapshot(row, () => callback(buttons)) : (buttons) => callback(buttons);
    const dispose = target.add(wrapped, placement);
    onCleanup(dispose);
    return dispose;
  }
  function onFrame(callback) {
    registerFrame(callback);
  }

  // vendor/pocketjs/framework/src/bytes.ts
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var B64_INV = {};
  for (let i = 0;i < B64.length; i++)
    B64_INV[B64[i]] = i;

  // vendor/pocketjs/framework/src/pak.ts
  var map = null;
  var bytes = null;
  function readKey(u8, off, len) {
    let s = "";
    for (let i = 0;i < len; i++)
      s += String.fromCharCode(u8[off + i]);
    return s;
  }
  function parse(ab) {
    const dv = new DataView(ab);
    if (ab.byteLength < PAK_HEADER_SIZE || dv.getUint32(0, true) !== PAK_MAGIC) {
      throw new Error("pak: bad magic");
    }
    const version = dv.getUint16(4, true);
    if (version !== PAK_VERSION) {
      throw new Error("pak: unsupported version " + version);
    }
    const entryCount = dv.getUint32(8, true);
    const dirOff = dv.getUint32(12, true);
    const namesOff = dv.getUint32(16, true);
    const u8 = new Uint8Array(ab);
    const m = new Map;
    for (let i = 0;i < entryCount; i++) {
      const e = dirOff + i * PAK_ENTRY_SIZE;
      const blobOff = dv.getUint32(e + 4, true);
      const byteLen = dv.getUint32(e + 8, true);
      const nameOff = dv.getUint32(e + 12, true);
      const nameLen = dv.getUint16(e + 16, true);
      const dtype = u8[e + 18];
      m.set(readKey(u8, namesOff + nameOff, nameLen), {
        off: blobOff,
        len: byteLen,
        dtype
      });
    }
    map = m;
    bytes = u8;
  }
  function loadPack(ab) {
    parse(ab);
  }
  function ensureLoaded() {
    if (map)
      return;
    const ab = globalThis.__pak;
    if (!ab)
      return;
    parse(ab);
  }
  function hasPack() {
    ensureLoaded();
    return map !== null;
  }
  function entries(prefix = "") {
    ensureLoaded();
    if (!map)
      return [];
    const out = [];
    for (const key of map.keys()) {
      if (key.length >= prefix.length && key.slice(0, prefix.length) === prefix) {
        out.push(key);
      }
    }
    out.sort();
    return out;
  }
  function get(key, start = 0, end) {
    ensureLoaded();
    const e = map ? map.get(key) : undefined;
    if (!e) {
      throw new Error("pak: missing key " + key + " (no __pak provided, or the pack is incomplete)");
    }
    const stop = end ?? e.len;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop) || start < 0 || stop < start || stop > e.len)
      throw new RangeError("pak: invalid byte range");
    return bytes.slice(e.off + start, e.off + stop);
  }

  // vendor/pocketjs/framework/src/input.ts
  var root = null;
  var focused = null;
  var pressedNode = null;
  var prevButtons = 0;
  var deferredPressCapture;
  var focusScopeStack = [];
  var focusGridStack = [];
  var focusControllerStack = [];
  function setInputRoot(r) {
    root = r;
    focused = null;
    pressedNode = null;
    prevButtons = 0;
    focusScopeStack.length = 0;
    focusGridStack.length = 0;
    focusControllerStack.length = 0;
    if (cursor) {
      cursor.pressTarget = null;
      cursor.target = null;
      cursor.spriteDirty = true;
      cursor.fresh = true;
      cursor.vw = 0;
      if (cursor.tex >= 0) {
        const ops = getOps();
        ops.setCursor?.(-1, 0, 0, 0, 0);
        ops.freeTexture?.(cursor.tex);
        cursor.tex = -1;
      }
    }
  }
  function registerPress(node, fn) {
    node.onPress = fn ?? undefined;
  }
  function registerFocusable(node, on) {
    node.focusable = on;
    __notifyTreeMutation();
    if (!on && focused === node) {
      focusNode(null);
    }
  }
  function focusNode(node) {
    if (pressedNode && pressedNode !== node)
      setPressedNode(null);
    focused = node;
    getOps().setFocus(node ? node.id : 0);
  }
  function setPressedNode(node) {
    if (pressedNode === node)
      return;
    const ops = getOps();
    if (pressedNode)
      ops.setActive?.(pressedNode.id, 0);
    pressedNode = node;
    if (node)
      ops.setActive?.(node.id, 1);
  }
  function activeFocusRoot() {
    return focusScopeStack.length > 0 ? focusScopeStack[focusScopeStack.length - 1] : root;
  }
  function collectFocusables(node, out) {
    if (!node)
      return;
    if (node.focusable)
      out.push(node);
    if (!Array.isArray(node.children))
      return;
    for (let i = 0;i < node.children.length; i++) {
      collectFocusables(node.children[i], out);
    }
  }
  function focusables() {
    const out = [];
    const r = activeFocusRoot();
    if (r)
      collectFocusables(r, out);
    return out;
  }
  function linearDirection(direction) {
    return direction === "down" || direction === "right" ? 1 : -1;
  }
  function moveLinearFocus(direction) {
    const dir = linearDirection(direction);
    const list = focusables();
    if (list.length === 0) {
      if (focused)
        focusNode(null);
      return;
    }
    const i = focused ? list.indexOf(focused) : -1;
    if (i < 0) {
      focusNode(dir === 1 ? list[0] : list[list.length - 1]);
      return;
    }
    const j = i + dir;
    if (j < 0 || j >= list.length)
      return;
    focusNode(list[j]);
  }
  function activeGrid() {
    if (!focused)
      return null;
    const active = activeFocusRoot();
    if (active && !isWithin(focused, active))
      return null;
    for (let i = focusGridStack.length - 1;i >= 0; i--) {
      const grid = focusGridStack[i];
      if (active && !isWithin(grid.node, active) && !isWithin(active, grid.node))
        continue;
      if (isWithin(focused, grid.node))
        return grid;
    }
    return null;
  }
  function moveGridFocus(direction) {
    const grid = activeGrid();
    if (!grid)
      return false;
    const list = [];
    collectFocusables(grid.node, list);
    if (list.length === 0) {
      if (focused)
        focusNode(null);
      return true;
    }
    const columns = grid.columns;
    const i = focused ? list.indexOf(focused) : -1;
    if (i < 0) {
      focusNode(linearDirection(direction) === 1 ? list[0] : list[list.length - 1]);
      return true;
    }
    let j = i;
    switch (direction) {
      case "right":
        if (i + 1 < list.length && i % columns < columns - 1)
          j = i + 1;
        else if (grid.wrap)
          j = Math.floor(i / columns) * columns;
        break;
      case "left":
        if (i % columns > 0)
          j = i - 1;
        else if (grid.wrap)
          j = Math.min(list.length - 1, Math.floor(i / columns) * columns + columns - 1);
        break;
      case "down":
        if (i + columns < list.length)
          j = i + columns;
        else if (grid.wrap)
          j = i % columns;
        break;
      case "up":
        if (i - columns >= 0)
          j = i - columns;
        else if (grid.wrap) {
          const col = i % columns;
          j = col;
          while (j + columns < list.length)
            j += columns;
        }
        break;
    }
    if (j !== i)
      focusNode(list[j]);
    return true;
  }
  function activeController() {
    if (!focused)
      return null;
    const active = activeFocusRoot();
    if (active && !isWithin(focused, active))
      return null;
    for (let i = focusControllerStack.length - 1;i >= 0; i--) {
      const ctl = focusControllerStack[i];
      if (active && !isWithin(ctl.node, active) && !isWithin(active, ctl.node))
        continue;
      if (isWithin(focused, ctl.node))
        return ctl;
    }
    return null;
  }
  function moveFocus(direction) {
    const ctl = activeController();
    if (ctl && ctl.move(direction))
      return;
    if (moveGridFocus(direction))
      return;
    moveLinearFocus(direction);
  }
  function withDeferredPress(defer, run) {
    const previous = deferredPressCapture;
    deferredPressCapture = defer;
    try {
      run();
    } finally {
      deferredPressCapture = previous;
    }
  }
  function firePress(defer) {
    firePressFrom(focused, defer);
  }
  function firePressFrom(start, defer = deferredPressCapture) {
    let n = start;
    while (n) {
      if (n.onPress) {
        if (defer) {
          const node = n, callback = n.onPress;
          defer(node, () => callback.call(node));
        } else
          n.onPress();
        return;
      }
      n = n.parent;
    }
  }
  function setActiveNode(node) {
    setPressedNode(node);
  }
  function pressNode(node) {
    focusNode(node);
    firePressFrom(node);
  }
  function isWithin(node, ancestor) {
    if (!node || !ancestor)
      return false;
    let n = node;
    while (n) {
      if (n === ancestor)
        return true;
      n = n.parent;
    }
    return false;
  }
  function firstFocusable(node) {
    if (!node)
      return null;
    if (node.focusable)
      return node;
    if (!Array.isArray(node.children))
      return null;
    for (let i = 0;i < node.children.length; i++) {
      const f = firstFocusable(node.children[i]);
      if (f)
        return f;
    }
    return null;
  }
  function notifyDetached(node) {
    if (!focused || !isWithin(focused, node))
      return;
    const parent = node.parent;
    if (parent) {
      const idx = parent.children.indexOf(node);
      for (let i = idx + 1;i < parent.children.length; i++) {
        const f = firstFocusable(parent.children[i]);
        if (f) {
          focusNode(f);
          return;
        }
      }
      for (let i = idx - 1;i >= 0; i--) {
        const f = firstFocusable(parent.children[i]);
        if (f) {
          focusNode(f);
          return;
        }
      }
      let a = parent;
      while (a) {
        if (a.focusable) {
          focusNode(a);
          return;
        }
        a = a.parent;
      }
    }
    focusNode(null);
  }
  var cursor = null;
  var inputGen = 0;
  function __notifyTreeMutation() {
    inputGen++;
  }
  var ARROW_OUTLINE = [1, 3, 5, 9, 17, 33, 65, 129, 257, 513, 1985, 73, 149, 147, 288, 480];
  var ARROW_FILL = [0, 0, 2, 6, 14, 30, 62, 126, 254, 510, 62, 54, 98, 96, 192, 0];
  function defaultArrowRGBA() {
    const px = new Uint8Array(16 * 16 * 4);
    for (let y = 0;y < 16; y++) {
      for (let x = 0;x < 16; x++) {
        const outline = ARROW_OUTLINE[y] >> x & 1;
        const fill = ARROW_FILL[y] >> x & 1;
        if (!outline && !fill)
          continue;
        const i = (y * 16 + x) * 4;
        const v = fill ? 255 : 0;
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
        px[i + 3] = 255;
      }
    }
    return px;
  }
  function cursorInitSprite(c, ops) {
    const sprite = c.sprite;
    c.spriteDirty = false;
    const old = c.tex;
    let tex = -1;
    let blob = null;
    if (typeof sprite.image === "string") {
      try {
        blob = get(sprite.image);
      } catch (err) {
        if (getHost().strict)
          throw err;
        blob = null;
      }
    } else if (sprite.image) {
      blob = sprite.image;
    }
    if (blob) {
      tex = ops.uploadImgEntry ? ops.uploadImgEntry(blob) : uploadImgFallback(ops, blob);
      if (tex < 0 && getHost().strict) {
        throw new Error("enableCursor: cursor image rejected (malformed or RLE-only IMG entry)");
      }
    }
    if (tex < 0) {
      tex = ops.uploadTexture(defaultArrowRGBA(), 16, 16, PSM.PSM_8888);
    }
    c.tex = tex;
    ops.setCursor(tex, sprite.hotspot[0], sprite.hotspot[1], sprite.size[0], sprite.size[1]);
    if (old >= 0 && old !== tex)
      ops.freeTexture?.(old);
  }
  function uploadImgFallback(ops, blob) {
    if (blob.length < 8)
      return -1;
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    if (blob[5] & IMG_FLAG_RLE)
      return -1;
    return ops.uploadTexture(blob.subarray(8), dv.getUint16(0, true), dv.getUint16(2, true), blob[4]);
  }
  function findMirror(node, id) {
    if (!node || id === 0)
      return null;
    if (node.id === id)
      return node;
    const kids = node.children;
    if (!Array.isArray(kids))
      return null;
    for (let i = 0;i < kids.length; i++) {
      const found = findMirror(kids[i], id);
      if (found)
        return found;
    }
    return null;
  }
  var hitRoot = null;
  var auxiliaryHitRoot = null;
  function setHitRoot(r) {
    hitRoot = r;
  }
  function setAuxiliaryHitRoot(r) {
    auxiliaryHitRoot = r;
  }
  function cursorTarget(hit) {
    const scope = focusScopeStack.length > 0 ? focusScopeStack[focusScopeStack.length - 1] : null;
    let n = hit;
    while (n) {
      if (n.focusable && (!scope || isWithin(n, scope)))
        return n;
      n = n.parent;
    }
    return null;
  }
  function touchFocusable(x, y, fact, surface = "primary") {
    return cursorTarget(resolveTouchHit(x, y, fact, surface));
  }
  function resolveTouchHit(x, y, fact, surface = "primary") {
    const searchRoot = surface === "auxiliary" ? auxiliaryHitRoot : hitRoot ?? root;
    if (!searchRoot)
      return null;
    if (fact !== undefined) {
      return fact === 0 ? null : findMirror(searchRoot, fact);
    }
    const ops = getOps();
    const query = surface === "auxiliary" ? ops.hitTestBoundsAuxiliary ?? ops.hitTestAuxiliary : ops.hitTestBounds ?? ops.hitTest;
    if (!query)
      return null;
    return findMirror(searchRoot, query(x, y));
  }
  function cursorFrame(buttons, pressed, released, defer) {
    const c = cursor;
    const ops = getOps();
    if (!ops.hitTest || !ops.setCursor || !ops.setCursorPos)
      return false;
    if (c.vw === 0) {
      const vp = hostViewport(ops);
      c.vw = vp ? vp.w : SCREEN_W;
      c.vh = vp ? vp.h : SCREEN_H;
      if (c.x < 0) {
        c.x = Math.floor(c.vw / 2);
        c.y = Math.floor(c.vh / 2);
      }
    }
    if (c.spriteDirty)
      cursorInitSprite(c, ops);
    let vx = analogX() * c.speed;
    let vy = analogY() * c.speed;
    if (c.dpadSpeed > 0 && vx === 0 && vy === 0) {
      if (buttons & BTN.LEFT)
        vx = -c.dpadSpeed;
      if (buttons & BTN.RIGHT)
        vx = c.dpadSpeed;
      if (buttons & BTN.UP)
        vy = -c.dpadSpeed;
      if (buttons & BTN.DOWN)
        vy = c.dpadSpeed;
    }
    let moved = c.fresh;
    if (vx !== 0 || vy !== 0) {
      const dt = ticksPerFrame() / TICKS_PER_SECOND;
      const nx = Math.min(Math.max(c.x + vx * dt, 0), c.vw - 1);
      const ny = Math.min(Math.max(c.y + vy * dt, 0), c.vh - 1);
      if (nx !== c.x || ny !== c.y) {
        c.x = nx;
        c.y = ny;
        moved = true;
      }
    }
    if (moved)
      ops.setCursorPos(c.x, c.y);
    const edges = (pressed | released) & c.button;
    const gen = inputGen;
    if (moved || edges !== 0 || gen !== c.gen) {
      c.gen = gen;
      c.fresh = false;
      c.target = cursorTarget(findMirror(hitRoot ?? root, ops.hitTest(c.x, c.y)));
    }
    const target = c.target;
    if (target !== focused)
      focusNode(target);
    if (pressed & c.button && target) {
      c.pressTarget = target;
    }
    if (c.pressTarget) {
      setPressedNode(target === c.pressTarget ? c.pressTarget : null);
      if (released & c.button) {
        const fire = target === c.pressTarget;
        c.pressTarget = null;
        setPressedNode(null);
        if (fire)
          firePress(defer);
      }
    } else if (released & c.button) {
      setPressedNode(null);
    }
    return true;
  }
  function handleFrame(buttons, defer) {
    const pressed = buttons & ~prevButtons;
    const released = prevButtons & ~buttons;
    prevButtons = buttons;
    if (cursor && cursorFrame(buttons, pressed, released, defer))
      return;
    if (released & BTN.CIRCLE)
      setPressedNode(null);
    if (pressed === 0)
      return;
    if (pressed & BTN.DOWN)
      moveFocus("down");
    if (pressed & BTN.RIGHT)
      moveFocus("right");
    if (pressed & BTN.UP)
      moveFocus("up");
    if (pressed & BTN.LEFT)
      moveFocus("left");
    if (pressed & BTN.CIRCLE) {
      setPressedNode(focused);
      firePress(defer);
    }
  }

  // vendor/pocketjs/framework/src/native-tree.ts
  var treeMutationHook = null;
  function setTreeMutationHook(fn) {
    treeMutationHook = fn;
  }
  function treeMutated() {
    __notifyTreeMutation();
    if (treeMutationHook)
      treeMutationHook();
  }
  function setDebugName(node, name) {
    node.debugName = name || undefined;
    treeMutated();
  }
  var rootMirror = {
    id: ROOT_ID,
    type: NODE_TYPE.view,
    parent: null,
    children: [],
    domNodeType: 1,
    domTag: "root"
  };
  var nativeRoots = new Set([rootMirror]);
  var DOM_NODE = Symbol.for("pocketjs.native-node");
  var DOM_ELEMENT = 1;
  var DOM_TEXT = 3;
  var DOM_COMMENT = 8;
  var NATIVE_ATTRIBUTE_NAMES = new Set(["class", "className", "style", "src", "sprite", "frameStep", "onPress", "on:press", "focusable", "debugName", "ref", "nodeRef", "key", "children"]);
  function domAttrs(node) {
    return node.domAttrs ??= {};
  }
  function cloneNativeNode(node, deep) {
    const nodeType = node.domNodeType ?? (isTextNode(node) ? DOM_TEXT : DOM_ELEMENT);
    const clone = nodeType === DOM_TEXT ? createTextNode(node.text ?? "") : nodeType === DOM_COMMENT ? createCommentNode(node.domData ?? "") : createElement(node.domTag ?? tagName(node));
    for (const key of Object.keys(node.domAttrs ?? {})) {
      setDomAttribute(clone, key, node.domAttrs[key]);
    }
    if (deep) {
      for (const child of node.children)
        insertNode(clone, cloneNativeNode(child, true));
    }
    return clone;
  }
  function setDomAttribute(node, name, value) {
    if (NATIVE_ATTRIBUTE_NAMES.has(name)) {
      setProp(node, name, value, node.domAttrs?.[name]);
      return;
    }
    if (value == null)
      delete domAttrs(node)[name];
    else
      domAttrs(node)[name] = value;
  }
  function decorateNativeNode(node) {
    if (node[DOM_NODE] === true)
      return node;
    Object.defineProperty(node, DOM_NODE, {
      value: true
    });
    Object.defineProperties(node, {
      nodeType: {
        configurable: true,
        get() {
          return node.domNodeType ?? (isTextNode(node) ? DOM_TEXT : DOM_ELEMENT);
        }
      },
      nodeValue: {
        configurable: true,
        get() {
          return node.domNodeType === DOM_COMMENT ? node.domData ?? "" : node.text ?? "";
        },
        set(value) {
          if (node.domNodeType === DOM_COMMENT)
            node.domData = String(value ?? "");
          else
            replaceText(node, String(value ?? ""));
        }
      },
      data: {
        configurable: true,
        get() {
          return node.domNodeType === DOM_COMMENT ? node.domData ?? "" : node.text ?? "";
        },
        set(value) {
          if (node.domNodeType === DOM_COMMENT)
            node.domData = String(value ?? "");
          else
            replaceText(node, String(value ?? ""));
        }
      },
      textContent: {
        configurable: true,
        get() {
          if (node.domNodeType === DOM_COMMENT)
            return node.domData ?? "";
          if (isTextNode(node))
            return node.text ?? "";
          return node.children.map((child) => child.text ?? "").join("");
        },
        set(value) {
          const text = String(value ?? "");
          if (node.domNodeType === DOM_COMMENT) {
            node.domData = text;
          } else if (isTextNode(node)) {
            replaceText(node, text);
          } else {
            clearContainer(node);
            if (text)
              insertNode(node, createTextNode(text));
          }
        }
      },
      parentNode: {
        configurable: true,
        get() {
          return node.parent;
        }
      },
      parentElement: {
        configurable: true,
        get() {
          return node.parent;
        }
      },
      childNodes: {
        configurable: true,
        get() {
          return node.children;
        }
      },
      firstChild: {
        configurable: true,
        get() {
          return node.children[0] ?? null;
        }
      },
      lastChild: {
        configurable: true,
        get() {
          return node.children[node.children.length - 1] ?? null;
        }
      },
      nextSibling: {
        configurable: true,
        get() {
          return getNextSibling(node) ?? null;
        }
      },
      previousSibling: {
        configurable: true,
        get() {
          const parent = node.parent;
          if (!parent)
            return null;
          const index = parent.children.indexOf(node);
          return index > 0 ? parent.children[index - 1] : null;
        }
      },
      tagName: {
        configurable: true,
        get() {
          return (node.domTag ?? tagName(node)).toUpperCase();
        }
      },
      nodeName: {
        configurable: true,
        get() {
          if (node.domNodeType === DOM_TEXT)
            return "#text";
          if (node.domNodeType === DOM_COMMENT)
            return "#comment";
          return (node.domTag ?? tagName(node)).toUpperCase();
        }
      },
      className: {
        configurable: true,
        get() {
          return String(node.domAttrs?.class ?? "");
        },
        set(value) {
          setProp(node, "class", value, node.domAttrs?.class);
        }
      },
      isConnected: {
        configurable: true,
        get() {
          let current = node;
          while (current) {
            if (nativeRoots.has(current))
              return true;
            current = current.parent;
          }
          return false;
        }
      }
    });
    const methods = {
      appendChild(child) {
        insertNode(node, child);
        return child;
      },
      insertBefore(child, anchor) {
        insertNode(node, child, anchor ?? null);
        return child;
      },
      removeChild(child) {
        removeNode(node, child);
        return child;
      },
      replaceChild(next, current) {
        insertNode(node, next, current);
        removeNode(node, current);
        return current;
      },
      cloneNode(deep = false) {
        return cloneNativeNode(node, !!deep);
      },
      remove() {
        if (node.parent)
          removeNode(node.parent, node);
      },
      setAttribute(name, value) {
        setDomAttribute(node, name, value);
      },
      removeAttribute(name) {
        setDomAttribute(node, name, undefined);
      },
      getAttribute(name) {
        const value = node.domAttrs?.[name];
        return value == null ? null : String(value);
      },
      hasAttribute(name) {
        return node.domAttrs?.[name] != null;
      },
      hasChildNodes() {
        return node.children.length > 0;
      },
      contains(other) {
        let current = other ?? null;
        while (current) {
          if (current === node)
            return true;
          current = current.parent;
        }
        return false;
      },
      addEventListener() {},
      removeEventListener() {}
    };
    Object.assign(node, methods, {
      style: {
        length: 0,
        item: () => ""
      },
      classList: {
        add() {},
        remove() {}
      }
    });
    return node;
  }
  decorateNativeNode(rootMirror);
  var styleResolver = null;
  function setStyleResolver(fn) {
    styleResolver = fn;
  }
  var missCounters = {
    unknownClass: 0,
    unknownTexture: 0,
    unknownSurface: 0
  };
  var textures = new Map;
  function registerTexture(key, handle) {
    textures.set(key, handle);
  }
  function resolveTexture(key) {
    const handle = textures.get(key);
    if (handle === undefined) {
      if (getHost().strict) {
        throw new Error(`PocketJS: unknown image src "${key}" - no texture registered under that key`);
      }
      missCounters.unknownTexture++;
    }
    return handle;
  }
  var sprites = new Map;
  function registerSprite(key, meta) {
    sprites.set(key, meta);
  }
  var sweepSet = new Set;
  var retained = new Set;
  function subtreeHasRetained(node) {
    if (!node)
      return false;
    if (retained.has(node))
      return true;
    if (node.children) {
      for (let i = 0;i < node.children.length; i++) {
        if (subtreeHasRetained(node.children[i]))
          return true;
      }
    }
    return false;
  }
  function runSweep() {
    if (sweepSet.size === 0)
      return;
    const ops = getOps();
    const keep = [];
    for (const node of sweepSet) {
      if (!node)
        continue;
      if (node.parent !== null)
        continue;
      if (nativeRoots.has(node))
        continue;
      if (subtreeHasRetained(node)) {
        keep.push(node);
        continue;
      }
      clearNodeReferences(node);
      ops.destroyNode(node.id);
    }
    sweepSet.clear();
    for (let i = 0;i < keep.length; i++)
      sweepSet.add(keep[i]);
  }
  function adoptNativeRoot(id, tag = "native-root") {
    if (!Number.isInteger(id) || id <= ROOT_ID) {
      throw new Error(`PocketJS: invalid adopted native root id ${id}`);
    }
    const root = decorateNativeNode({
      id,
      type: NODE_TYPE.view,
      parent: null,
      children: [],
      domNodeType: DOM_ELEMENT,
      domTag: tag
    });
    nativeRoots.add(root);
    return root;
  }
  function releaseNativeRoot(root) {
    if (root === rootMirror)
      return;
    if (root.children.length > 0) {
      throw new Error("PocketJS: cannot release a native root with mounted children");
    }
    nativeRoots.delete(root);
    sweepSet.delete(root);
    retained.delete(root);
  }
  function createElement(tag) {
    const type = NODE_TYPE[tag];
    if (type === undefined) {
      throw new Error(`PocketJS: unknown element <${tag}> - only view/text/image/surface exist`);
    }
    return decorateNativeNode({
      id: getOps().createNode(type),
      type,
      parent: null,
      children: [],
      domNodeType: DOM_ELEMENT,
      domTag: tag
    });
  }
  function createTextNode(value) {
    value = String(value);
    const ops = getOps();
    const id = ops.createNode(NODE_TYPE.text);
    ops.setText(id, value);
    return decorateNativeNode({
      id,
      type: NODE_TYPE.text,
      parent: null,
      children: [],
      text: value,
      domNodeType: DOM_TEXT,
      domTag: "#text"
    });
  }
  function createCommentNode(data = "") {
    const node = createTextNode("");
    node.domNodeType = DOM_COMMENT;
    node.domTag = "#comment";
    node.domData = data;
    return node;
  }
  function replaceText(node, value) {
    value = String(value);
    getOps().replaceText(node.id, value);
    node.text = value;
    treeMutated();
  }
  function isTextNode(node) {
    return node.type === NODE_TYPE.text;
  }
  function unlink(node) {
    const p = node.parent;
    if (!p)
      return;
    const i = p.children.indexOf(node);
    if (i >= 0)
      p.children.splice(i, 1);
    node.parent = null;
  }
  function insertNode(parent, node, anchor) {
    const ops = getOps();
    if (anchor && (anchor.parent !== parent || !parent.children.includes(anchor))) {
      throw new Error("PocketJS: insert anchor is not a child of parent");
    }
    if (anchor === node) {
      sweepSet.delete(node);
      return;
    }
    unlink(node);
    sweepSet.delete(node);
    ops.insertBefore(parent.id, node.id, anchor ? anchor.id : 0);
    if (anchor) {
      const i = parent.children.indexOf(anchor);
      parent.children.splice(i, 0, node);
    } else {
      parent.children.push(node);
    }
    node.parent = parent;
    treeMutated();
  }
  function removeNode(parent, node) {
    if (!node)
      return;
    notifyDetached(node);
    getOps().removeChild(parent.id, node.id);
    unlink(node);
    sweepSet.add(node);
    treeMutated();
  }
  function detachNode(parent, node) {
    removeNode(parent, node);
  }
  function getParentNode(node) {
    return node.parent ?? undefined;
  }
  function getFirstChild(node) {
    return node.children[0];
  }
  function getNextSibling(node) {
    const p = node.parent;
    if (!p)
      return;
    const i = p.children.indexOf(node);
    return i >= 0 ? p.children[i + 1] : undefined;
  }
  function setClass(node, value) {
    const ops = getOps();
    treeMutated();
    if (value == null || value === "") {
      ops.setStyle(node.id, STYLE_ID_NONE);
      return;
    }
    if (typeof value !== "string") {
      throw new Error("PocketJS: class must be a string literal of utilities");
    }
    const styleId = styleResolver ? styleResolver(value) : undefined;
    if (styleId === undefined) {
      if (getHost().strict) {
        throw new Error(`PocketJS: unknown class "${value}" - not in the compiled style table ` + "(dynamic classes must be ternaries of full literals)");
      }
      missCounters.unknownClass++;
      return;
    }
    ops.setStyle(node.id, styleId);
  }
  function setSrc(node, value) {
    const ops = getOps();
    if (value == null || value === "") {
      ops.setImage(node.id, -1);
      return;
    }
    if (typeof value !== "string") {
      throw new Error("PocketJS: src must be a string key");
    }
    const handle = resolveTexture(value);
    if (handle !== undefined)
      ops.setImage(node.id, handle);
  }
  function spriteStep(node, fallback, value = node.domAttrs?.frameStep) {
    if (value == null)
      return fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("PocketJS: frameStep must be a finite number");
    }
    return Math.min(65535, Math.max(1, Math.floor(value)));
  }
  function setSpriteSrc(node, value) {
    const ops = getOps();
    if (value == null || value === "") {
      ops.setSprite(node.id, -1, 0, 0, 0);
      return;
    }
    if (typeof value !== "string") {
      throw new Error("PocketJS: sprite must be a string key");
    }
    const meta = sprites.get(value);
    if (meta === undefined) {
      if (getHost().strict) {
        throw new Error(`PocketJS: unknown sprite "${value}" - no sprite atlas registered under that key`);
      }
      missCounters.unknownTexture++;
      return;
    }
    ops.setSprite(node.id, meta.handle, meta.frames, meta.cols, spriteStep(node, meta.step));
  }
  function setCompositorBinding(node) {
    const ops = getOps();
    const bind = ops.setCompositorSurface;
    if (!bind) {
      return;
    }
    if (!ops.__surfaces) {
      return;
    }
    const packageId = node.domAttrs?.package;
    const focused = node.domAttrs?.focused === true ? 1 : 0;
    if (packageId == null || packageId === "") {
      bind(node.id, -1, focused);
      return;
    }
    if (typeof packageId !== "string") {
      throw new Error("PocketJS: compositor surface package must be a string id");
    }
    const handle = ops.__surfaces[packageId];
    if (handle === undefined) {
      if (getHost().strict) {
        throw new Error(`PocketJS: package ${JSON.stringify(packageId)} is not installed in this Pocket System`);
      }
      missCounters.unknownSurface++;
      bind(node.id, -1, focused);
      return;
    }
    bind(node.id, handle, focused);
  }
  function setStyleObject(node, value, prev) {
    const ops = getOps();
    const next = value ?? {};
    const before = prev ?? {};
    let changed = false;
    for (const key in next) {
      const v = next[key];
      if (before[key] === v)
        continue;
      const propId = PROP[key];
      if (propId === undefined) {
        throw new Error(`PocketJS: unknown style prop '${key}' (see spec PROP)`);
      }
      ops.setProp(node.id, propId, encodePropValue(key, v));
      changed = true;
    }
    if (changed)
      treeMutated();
  }
  function setProp(node, name, value, prev) {
    if (value === prev && name !== "style")
      return value;
    if (name === "className")
      name = "class";
    if (name !== "children" && name !== "key" && name !== "ref" && name !== "nodeRef") {
      if (value == null)
        delete domAttrs(node)[name];
      else
        domAttrs(node)[name] = value;
    }
    switch (name) {
      case "class":
        setClass(node, value);
        return value;
      case "onPress":
      case "on:press":
        registerPress(node, value);
        return value;
      case "src":
        setSrc(node, value);
        return value;
      case "sprite":
        setSpriteSrc(node, value);
        return value;
      case "frameStep":
        if (value != null)
          spriteStep(node, 1, value);
        if (node.domAttrs?.sprite != null) {
          const key = node.domAttrs.sprite;
          const meta = sprites.get(String(key));
          if (meta !== undefined) {
            getOps().setSprite(node.id, meta.handle, meta.frames, meta.cols, spriteStep(node, meta.step, value));
          } else {
            setSpriteSrc(node, key);
          }
        }
        return value;
      case "package":
      case "focused":
        setCompositorBinding(node);
        return value;
      case "style":
        setStyleObject(node, value, prev);
        return value;
      case "focusable":
        registerFocusable(node, !!value);
        return value;
      case "debugName":
        setDebugName(node, value == null ? undefined : String(value));
        return value;
      case "ref":
      case "nodeRef":
      case "key":
      case "children":
        return value;
      default:
        break;
    }
    if (name === "classList") {
      throw new Error("PocketJS: classList is not supported - use ternaries of full class literals");
    }
    if (name.startsWith("on:") || name.startsWith("bool:") || name.startsWith("prop:")) {
      throw new Error(`PocketJS: unsupported namespaced attribute '${name}'`);
    }
    throw new Error(`PocketJS: unknown property '${name}' on <${tagName(node)}>`);
  }
  function clearContainer(container) {
    for (const child of [...container.children])
      removeNode(container, child);
  }
  function tagName(node) {
    for (const key of Object.keys(NODE_TYPE)) {
      if (NODE_TYPE[key] === node.type)
        return key;
    }
    return String(node.type);
  }

  // vendor/pocketjs/framework/src/renderer-solid.ts
  function setProperty(node, name, value, prev) {
    if (name === "ref" && typeof value === "function") {
      value(node);
      return;
    }
    setProp(node, name, value, prev);
  }
  var renderer = createRenderer({
    createElement(type) {
      const node = createElement(type);
      captureNodeRow(node);
      return node;
    },
    createTextNode,
    replaceText,
    isTextNode,
    setProperty,
    insertNode(parent, node, anchor) {
      insertNode(parent, node, anchor);
    },
    removeNode(parent, node) {
      removeNode(parent, node);
    },
    getParentNode,
    getFirstChild,
    getNextSibling
  });
  var {
    render,
    effect,
    memo: memo2,
    createComponent: createComponent2,
    createElement: createElement2,
    insert,
    spread,
    mergeProps: mergeProps2,
    use
  } = renderer;

  // vendor/pocketjs/framework/src/overlay.ts
  var overlayRoot = null;
  function setOverlayRoot(root) {
    overlayRoot = root;
  }

  // vendor/pocketjs/framework/src/display.ts
  var roots2 = null;
  function layerStyle(width, height, overlay) {
    return overlay ? {
      width,
      height,
      posType: ENUMS.PosType.Absolute,
      insetT: 0,
      insetR: 0,
      insetB: 0,
      insetL: 0,
      zIndex: 1000,
      hitPass: 1
    } : {
      width,
      height,
      overflow: ENUMS.Overflow.Hidden
    };
  }
  function layer(width, height, overlay) {
    const node = createElement("view");
    setProp(node, "style", layerStyle(width, height, overlay), undefined);
    return node;
  }
  function mountAuxiliarySurface(ops) {
    const descriptor = ops.__auxiliarySurface;
    if (!descriptor) {
      roots2 = null;
      return null;
    }
    if (!Number.isInteger(descriptor.root) || descriptor.root <= 1 || !Number.isFinite(descriptor.w) || descriptor.w <= 0 || !Number.isFinite(descriptor.h) || descriptor.h <= 0) {
      throw new Error("PocketJS: invalid ui.__auxiliarySurface descriptor");
    }
    const native = adoptNativeRoot(descriptor.root, "auxiliary-root");
    const app = layer(descriptor.w, descriptor.h, false);
    const overlay = layer(descriptor.w, descriptor.h, true);
    insertNode(native, app);
    insertNode(native, overlay);
    roots2 = {
      native,
      app,
      overlay,
      viewport: Object.freeze({
        width: descriptor.w,
        height: descriptor.h
      })
    };
    return roots2;
  }
  function unmountAuxiliarySurface(ops) {
    const mounted = roots2;
    roots2 = null;
    if (!mounted)
      return;
    for (const child of mounted.native.children.splice(0)) {
      child.parent = null;
      ops.destroyNode(child.id);
    }
    releaseNativeRoot(mounted.native);
  }
  function hasAuxiliarySurface() {
    return roots2 !== null;
  }
  function getAuxiliarySurfaceRoots() {
    if (!roots2) {
      throw new Error("PocketJS: AuxiliarySurface requires a resolved display.auxiliary capability");
    }
    return roots2;
  }

  // vendor/pocketjs/framework/src/resource-boundary.ts
  function ResourceBoundary(props) {
    const state = createMemo(props.state);
    const status = createMemo(() => state().status);
    const error = createMemo(() => {
      const value = state();
      return value.status === "error" ? value.error : undefined;
    });
    return createMemo(() => {
      const phase = status();
      const reason = phase === "error" ? error() : undefined;
      if (phase !== "ready")
        return phase === "error" && props.errorFallback ? props.errorFallback(reason) : props.fallback();
      return untrack(() => {
        return props.children(() => {
          const current = state();
          if (current.status !== "ready")
            throw new Error("Resource read outside its ready subtree");
          return current.value;
        });
      });
    });
  }

  // vendor/pocketjs/framework/src/resource-state.ts
  var PENDING2 = Object.freeze({
    status: "pending"
  });
  var pending4 = () => PENDING2;
  // vendor/pocketjs/framework/src/primitives.ts
  function callRef(ref, node) {
    if (!ref)
      return;
    if (typeof ref === "function")
      ref(node);
    else if ("current" in ref)
      ref.current = node;
  }
  function primitive(tag, props) {
    const el = createElement2(tag);
    spread(el, props, false);
    callRef(props.nodeRef, el);
    return el;
  }
  function View(props) {
    return primitive("view", props);
  }
  function Text(props) {
    if ("resource" in props) {
      const [state, setState] = createSignal(pending4());
      createRenderEffect(() => {
        const resource = props.resource;
        const update = () => setState(() => resource?.state() ?? pending4());
        untrack(update);
        const unsubscribe = resource?.subscribe(update);
        onCleanup(() => unsubscribe?.());
      });
      return ResourceBoundary({
        state,
        fallback: () => props.fallback?.() ?? null,
        errorFallback: (error) => props.errorFallback?.(error) ?? props.fallback?.() ?? null,
        children: (value) => primitive("text", {
          get class() {
            return props.class;
          },
          get style() {
            return {
              ...props.style,
              fontSlot: value().slot
            };
          },
          get debugName() {
            return props.debugName;
          },
          get ref() {
            return props.ref;
          },
          get nodeRef() {
            return props.nodeRef;
          },
          get children() {
            return value().text;
          }
        })
      });
    }
    return primitive("text", props);
  }
  function Image(props) {
    return primitive("image", props);
  }
  // vendor/pocketjs/framework/src/hot.ts
  var lastText = new WeakMap;
  var lastProp = new WeakMap;

  // vendor/pocketjs/contracts/spec/net.ts
  var NET_MAX_REQUEST_BYTES = 64 * 1024;
  var NET_DEFAULT_RESPONSE_BYTES = 128 * 1024;
  var NET_MAX_RESPONSE_BYTES = 256 * 1024;
  var NET_MAX_HEADER_BYTES = 8 * 1024;

  // vendor/pocketjs/framework/src/platform.ts
  var features = typeof { "display.auxiliary": true, "input.buttons": true, "input.touch.auxiliary": true, "text.glyphs.baked": true } === "object" && { "display.auxiliary": true, "input.buttons": true, "input.touch.auxiliary": true, "text.glyphs.baked": true } !== null ? Object.freeze({
    ...{ "display.auxiliary": true, "input.buttons": true, "input.touch.auxiliary": true, "text.glyphs.baked": true }
  }) : Object.freeze({});
  var platform = Object.freeze({
    target: "rg-ds-plus",
    pixelRatio: Number.isInteger(2) ? 2 : 1,
    features,
    httpResponseBytes: Number.isInteger(4194304) && 4194304 >= NET_MAX_RESPONSE_BYTES ? 4194304 : NET_MAX_RESPONSE_BYTES
  });
  function hasFeature(feature) {
    return platform.features[feature] === true;
  }

  // vendor/pocketjs/framework/src/tiles.ts
  var parsed = new Map;

  // vendor/pocketjs/framework/src/deepzoom.ts
  var TICK_SCALE = 60 / TICKS_PER_SECOND;
  var perTick = (at60) => TICK_SCALE === 1 ? at60 : at60 ** TICK_SCALE;
  var PAN_SPEED = 7 * TICK_SCALE;
  var DPAD_SPEED = 5 * TICK_SCALE;
  var ZOOM_STEP = perTick(1.035);
  var VEL_APPROACH = TICK_SCALE === 1 ? 0.35 : 1 - perTick(1 - 0.35);
  var VEL_DECAY = perTick(0.88);
  // vendor/pocketjs/framework/src/components.ts
  function renderPortalChild(child) {
    if (typeof child === "function")
      return child();
    return child;
  }
  function AuxiliarySurface(props) {
    let host;
    let dispose;
    onMount(() => {
      const surface = getAuxiliarySurfaceRoots();
      host = createElement2("view");
      setProp(host, "style", {
        width: surface.viewport.width,
        height: surface.viewport.height,
        overflow: ENUMS.Overflow.Hidden
      }, undefined);
      insertNode(surface.app, host);
      dispose = render(() => renderPortalChild(props.children), host);
    });
    onCleanup(() => {
      dispose?.();
      if (host?.parent)
        detachNode(host.parent, host);
    });
    return null;
  }
  // vendor/pocketjs/framework/src/touch.ts
  var LEGACY_COORD_BITS = 9;
  var LEGACY_COORD_MASK = (1 << LEGACY_COORD_BITS) - 1;
  var LEGACY_ID_SHIFT = LEGACY_COORD_BITS * 2;
  var WIDE_MARKER = 2147483648;
  var WIDE_COORD_BITS = 10;
  var WIDE_COORD_MASK = (1 << WIDE_COORD_BITS) - 1;
  var WIDE_ID_SHIFT = WIDE_COORD_BITS * 2;
  var CANCEL_MARKER = 1073741824;
  var EMPTY = Object.freeze([]);
  var primarySnapshot = EMPTY;
  var auxiliarySnapshot = EMPTY;
  var allSnapshot = EMPTY;
  var cancelledSnapshot = EMPTY;
  function __setTouches(packed, hits, surfaces) {
    cancelledSnapshot = EMPTY;
    if (!packed || packed.length === 0) {
      primarySnapshot = EMPTY;
      auxiliarySnapshot = EMPTY;
      allSnapshot = EMPTY;
      return;
    }
    const all = [], cancelled = [];
    for (let index = 0;index < Math.min(packed.length, 16); index++) {
      const value = packed[index];
      const output = value & CANCEL_MARKER ? cancelled : all;
      if (output.length >= 8)
        continue;
      const wide = (value & WIDE_MARKER) !== 0;
      const coordBits = wide ? WIDE_COORD_BITS : LEGACY_COORD_BITS;
      const coordMask = wide ? WIDE_COORD_MASK : LEGACY_COORD_MASK;
      const idShift = wide ? WIDE_ID_SHIFT : LEGACY_ID_SHIFT;
      output.push(Object.freeze({
        surface: surfaces?.[index] === 1 ? "auxiliary" : "primary",
        id: value >>> idShift & 255,
        x: value & coordMask,
        y: value >>> coordBits & coordMask,
        hit: hits?.[index]
      }));
    }
    cancelledSnapshot = Object.freeze(cancelled);
    allSnapshot = Object.freeze(all);
    primarySnapshot = Object.freeze(all.filter((contact) => contact.surface === "primary"));
    auxiliarySnapshot = Object.freeze(all.filter((contact) => contact.surface === "auxiliary"));
  }
  function auxiliaryTouches() {
    return auxiliarySnapshot;
  }
  function __cancelledTouches() {
    return cancelledSnapshot;
  }
  function __allTouches() {
    return allSnapshot;
  }
  function __resetTouches() {
    cancelledSnapshot = EMPTY;
    primarySnapshot = EMPTY;
    auxiliarySnapshot = EMPTY;
    allSnapshot = EMPTY;
  }
  // vendor/pocketjs/contracts/spec/input.ts
  var INPUT_CLASSES = {
    buttons: {
      bit: 1 << 0,
      constant: "BUTTONS",
      capabilities: ["input.buttons"]
    },
    "axis.absolute": {
      bit: 1 << 1,
      constant: "AXIS_ABSOLUTE",
      capabilities: ["input.analog.left", "input.analog.right"]
    },
    "axis.relative": {
      bit: 1 << 2,
      constant: "AXIS_RELATIVE",
      capabilities: ["input.axis.relative"]
    },
    pointer: {
      bit: 1 << 3,
      constant: "POINTER",
      capabilities: ["input.pointer"]
    },
    contact: {
      bit: 1 << 4,
      constant: "CONTACT",
      capabilities: ["input.touch", "input.touch.auxiliary"]
    },
    text: {
      bit: 1 << 5,
      constant: "TEXT",
      capabilities: ["input.text", "input.ime"]
    },
    motion: {
      bit: 1 << 6,
      constant: "MOTION",
      capabilities: ["input.motion.gravity", "input.motion.inertial", "input.motion.geomagnetic"]
    }
  };
  var ABSOLUTE_AXES = {
    LEFT_X: 0,
    LEFT_Y: 1,
    RIGHT_X: 2,
    RIGHT_Y: 3
  };
  var TEXT_EVENT_KINDS = {
    KEY_DOWN: 0,
    KEY_UP: 1,
    COMMIT: 2,
    COMPOSITION: 3,
    COMPOSITION_END: 4
  };
  var constantName = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  var INPUT_ABI_CONSTANTS = {
    ...Object.fromEntries(Object.values(INPUT_CLASSES).map((value) => [`POCKET_INPUT_CLASS_${value.constant}`, value.bit])),
    ...Object.fromEntries(Object.entries(BTN).map(([name, value]) => [`POCKET_BUTTON_${name}`, value])),
    POCKET_ANALOG_CENTER: ANALOG_CENTER,
    ...Object.fromEntries(Object.entries(ABSOLUTE_AXES).map(([name, value]) => [`POCKET_AXIS_${name}`, value])),
    ...Object.fromEntries(Object.entries(RelativeAxis).map(([name, value]) => [`POCKET_RELATIVE_AXIS_${constantName(name)}`, value])),
    ...Object.fromEntries(Object.entries(RelativeAxisUnits).map(([name, value]) => [`POCKET_RELATIVE_AXIS_${constantName(name)}`, value])),
    ...Object.fromEntries(Object.entries(TEXT_EVENT_KINDS).map(([name, value]) => [`POCKET_TEXT_${name}`, value])),
    ...Object.fromEntries(Object.entries(MotionLevel).map(([name, value]) => [`POCKET_MOTION_LEVEL_${constantName(name)}`, value])),
    ...Object.fromEntries(Object.entries(MotionQuality).map(([name, value]) => [`POCKET_MOTION_QUALITY_${constantName(name)}`, value])),
    ...Object.fromEntries(Object.entries(MotionReferenceFrame).map(([name, value]) => [`POCKET_MOTION_REFERENCE_${constantName(name)}`, value])),
    ...Object.fromEntries(Object.entries(MOTION_VALUES).map(([name, value]) => [`POCKET_MOTION_VALUE_${constantName(name)}`, value.id]))
  };

  // vendor/pocketjs/framework/src/text-input.ts
  var hasTextInput = hasFeature("input.text");
  var handlers = [];
  var pending5 = [];
  function decodeTextEvent(record) {
    switch (record.kind) {
      case TEXT_EVENT_KINDS.KEY_DOWN:
      case TEXT_EVENT_KINDS.KEY_UP:
        return {
          kind: "key",
          key: record.text ?? "",
          pressed: record.kind === TEXT_EVENT_KINDS.KEY_DOWN,
          repeat: record.repeat === true
        };
      case TEXT_EVENT_KINDS.COMMIT:
        return {
          kind: "commit",
          text: record.text ?? ""
        };
      case TEXT_EVENT_KINDS.COMPOSITION:
        return {
          kind: "composition",
          text: record.text ?? "",
          selectionStart: record.selectionStart ?? 0,
          selectionEnd: record.selectionEnd ?? 0
        };
      case TEXT_EVENT_KINDS.COMPOSITION_END:
        return {
          kind: "compositionEnd"
        };
      default:
        return null;
    }
  }
  function __setTextEvents(records) {
    if (!records || records.length === 0) {
      pending5 = [];
      return;
    }
    const events = [];
    for (const record of records) {
      const event = decodeTextEvent(record);
      if (event)
        events.push(event);
    }
    pending5 = events;
  }
  function __dispatchTextEvents() {
    if (pending5.length === 0)
      return;
    const events = pending5;
    pending5 = [];
    for (const event of events) {
      for (let i = handlers.length - 1;i >= 0; i--) {
        if (handlers[i](event) === true)
          break;
      }
    }
  }
  function __resetTextInput() {
    handlers.length = 0;
    pending5 = [];
  }
  // shell/src/bridge.ts
  var host = globalThis.omarchyBridge;
  var pending6 = new Map;
  var listeners = new Set;
  var nextId = 1;
  function request(body) {
    if (!host)
      return Promise.reject(new Error("no Omarchy bridge in this host"));
    const id = nextId++;
    host.send(JSON.stringify({
      ...body,
      id
    }));
    return new Promise((resolve, reject) => pending6.set(id, {
      resolve,
      reject
    }));
  }
  function onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  var run = (command) => request({
    method: "run",
    command
  });
  var conditions = (commands) => request({
    method: "conditions",
    commands
  });
  function answer(call, handled, output = "") {
    request({
      method: "answer",
      call,
      handled,
      output
    });
  }
  globalThis.__omarchyBridgeReceive = (lines) => {
    for (const line of lines) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if ("event" in message) {
        for (const listener of listeners)
          listener(message);
      } else if ("id" in message) {
        const waiter = pending6.get(message.id);
        if (!waiter)
          continue;
        pending6.delete(message.id);
        if (message.ok)
          waiter.resolve(message.result);
        else
          waiter.reject(new Error(message.error));
      }
    }
  };
  // shell/src/motion.ts
  var TOP_LEFT = {
    originX: -0.5,
    originY: -0.5
  };
  var slow = 1;
  var setSlowMotion = (factor) => slow = Math.max(1, factor);
  var slowed = (ms) => ms * slow;
  function flip(node, from, to, fromAlpha = 1, toAlpha = 1, ms = 200) {
    jump(node, "translateX", from.x - to.x);
    jump(node, "translateY", from.y - to.y);
    jump(node, "scaleX", to.w > 0 ? from.w / to.w : 1);
    jump(node, "scaleY", to.h > 0 ? from.h / to.h : 1);
    jump(node, "opacity", fromAlpha);
    const opts = {
      dur: slowed(ms),
      easing: "out"
    };
    animate(node, "translateX", 0, opts);
    animate(node, "translateY", 0, opts);
    animate(node, "scaleX", 1, opts);
    animate(node, "scaleY", 1, opts);
    animate(node, "opacity", toAlpha, opts);
  }
  function glide(node, prop, to, ms = 140) {
    if (node)
      animate(node, prop, to, {
        dur: slowed(ms),
        easing: "out"
      });
  }
  function place(node, prop, to) {
    if (node)
      jump(node, prop, to);
  }

  // shell/src/wm.ts
  var STAGE_W = 512;
  var STAGE_H = 384;
  var BAR_H = 18;
  var GAP_OUT = 6;
  var GAP_IN = 3;
  var BORDER = 2;
  var WORKSPACES = 5;
  var COLUMN_WIDTHS = [0.33, 0.49, 0.66, 1];
  var DEFAULT_COLUMN = 0.49;
  var MIN_RATIO = 0.15;
  var MAX_RATIO = 0.85;
  var RESIZE_STEP = 0.05;
  var MIN_COLUMN = 0.2;
  var PAN_STEP = 64;
  var REOPEN_DEPTH = 8;
  var contains = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  var sameRect = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  var wrap = (v) => (v % WORKSPACES + WORKSPACES) % WORKSPACES;
  function leaves(node, out = []) {
    if (!node)
      return out;
    if (node.kind === "leaf")
      out.push(node.win);
    else {
      leaves(node.a, out);
      leaves(node.b, out);
    }
    return out;
  }
  function path(node, win, chain = []) {
    if (!node)
      return null;
    if (node.kind === "leaf")
      return node.win === win ? chain : null;
    for (const side of ["a", "b"]) {
      chain.push({
        split: node,
        side
      });
      if (path(node[side], win, chain))
        return chain;
      chain.pop();
    }
    return null;
  }
  function halves(split, rect) {
    if (split.axis === "x") {
      const w = Math.round(rect.w * split.ratio);
      return [{
        ...rect,
        w
      }, {
        ...rect,
        x: rect.x + w,
        w: rect.w - w
      }];
    }
    const h = Math.round(rect.h * split.ratio);
    return [{
      ...rect,
      h
    }, {
      ...rect,
      y: rect.y + h,
      h: rect.h - h
    }];
  }
  function place2(node, rect, out) {
    if (node.kind === "leaf")
      return void out.set(node.win, rect);
    const [a, b] = halves(node, rect);
    place2(node.a, a, out);
    place2(node.b, b, out);
  }

  class WindowManager {
    windows = new Map;
    spaces = Array.from({
      length: WORKSPACES
    }, () => ({
      layout: "dwindle",
      root: null,
      columns: [],
      scroll: 0,
      focus: null,
      fullscreen: null
    }));
    active = 0;
    bar = "top";
    closed = [];
    nextId = 1;
    area() {
      const top = this.bar === "top" ? BAR_H : 0;
      const bottom = this.bar === "bottom" ? BAR_H : 0;
      return {
        x: GAP_OUT,
        y: top + GAP_OUT,
        w: STAGE_W - 2 * GAP_OUT,
        h: STAGE_H - top - bottom - 2 * GAP_OUT
      };
    }
    layout(ws = this.active) {
      return this.spaces[ws].layout;
    }
    focused(ws = this.active) {
      const id = this.spaces[ws].focus;
      return id === null ? null : this.windows.get(id) ?? null;
    }
    order(ws = this.active) {
      const space = this.spaces[ws];
      return space.layout === "dwindle" ? leaves(space.root) : space.columns.flatMap((c) => c.wins);
    }
    occupied(ws) {
      return this.order(ws).length > 0;
    }
    cells(ws) {
      const space = this.spaces[ws];
      const area = this.area();
      const out = new Map;
      if (space.layout === "dwindle") {
        if (space.root)
          place2(space.root, area, out);
        return out;
      }
      let x = area.x - space.scroll;
      for (const column of space.columns) {
        const w = Math.round(area.w * column.width);
        const h = area.h / column.wins.length;
        column.wins.forEach((id, i) => out.set(id, {
          x,
          y: Math.round(area.y + i * h),
          w,
          h: Math.round(h)
        }));
        x += w;
      }
      return out;
    }
    placements(ws = this.active) {
      const space = this.spaces[ws];
      const out = [];
      for (const [id, cell] of this.cells(ws)) {
        out.push({
          id,
          rect: {
            x: cell.x + GAP_IN,
            y: cell.y + GAP_IN,
            w: cell.w - 2 * GAP_IN,
            h: cell.h - 2 * GAP_IN
          },
          hidden: false
        });
      }
      const full = space.fullscreen;
      if (full && this.windows.has(full.win)) {
        const area = this.area();
        for (const p of out) {
          if (p.id !== full.win)
            p.hidden = true;
          else
            p.rect = full.mode === "full" ? {
              x: 0,
              y: 0,
              w: STAGE_W,
              h: STAGE_H
            } : {
              ...area
            };
        }
      }
      return out;
    }
    windowAt(x, y, ws = this.active) {
      return this.placements(ws).find((p) => !p.hidden && contains(p.rect, x, y))?.id ?? null;
    }
    find(match) {
      for (const w of this.windows.values())
        if (match(w))
          return w;
      return null;
    }
    open(content, ws = this.active) {
      const id = this.nextId++;
      this.windows.set(id, {
        ...content,
        id,
        ws
      });
      this.insert(ws, id);
      return id;
    }
    insert(ws, id) {
      const space = this.spaces[ws];
      space.fullscreen = null;
      const target = space.focus ?? this.order(ws).at(-1) ?? null;
      if (space.layout === "scrolling") {
        const at = target === null ? -1 : space.columns.findIndex((c) => c.wins.includes(target));
        space.columns.splice(at + 1, 0, {
          wins: [id],
          width: DEFAULT_COLUMN
        });
      } else if (!space.root || target === null) {
        space.root = {
          kind: "leaf",
          win: id
        };
      } else {
        const cell = this.cells(ws).get(target);
        const chain = path(space.root, target);
        const split = {
          kind: "split",
          axis: cell.w >= cell.h ? "x" : "y",
          ratio: 0.5,
          a: {
            kind: "leaf",
            win: target
          },
          b: {
            kind: "leaf",
            win: id
          }
        };
        const parent = chain.at(-1);
        if (parent)
          parent.split[parent.side] = split;
        else
          space.root = split;
      }
      space.focus = id;
      this.reveal(ws);
    }
    remove(id) {
      const win = this.windows.get(id);
      if (!win)
        return;
      const space = this.spaces[win.ws];
      let next = null;
      if (space.layout === "scrolling") {
        const ci = space.columns.findIndex((c) => c.wins.includes(id));
        if (ci < 0)
          return;
        const column = space.columns[ci];
        const row = column.wins.indexOf(id);
        column.wins.splice(row, 1);
        if (!column.wins.length)
          space.columns.splice(ci, 1);
        const near = space.columns[Math.min(ci, space.columns.length - 1)];
        next = column.wins[Math.min(row, column.wins.length - 1)] ?? near?.wins[0] ?? null;
      } else {
        const chain = path(space.root, id);
        if (!chain)
          return;
        const parent = chain.at(-1);
        if (!parent)
          space.root = null;
        else {
          const sibling = parent.split[parent.side === "a" ? "b" : "a"];
          const grand = chain.at(-2);
          if (grand)
            grand.split[grand.side] = sibling;
          else
            space.root = sibling;
          next = leaves(sibling)[0] ?? null;
        }
      }
      if (space.fullscreen?.win === id)
        space.fullscreen = null;
      if (space.focus === id)
        space.focus = next ?? this.order(win.ws)[0] ?? null;
      this.reveal(win.ws);
    }
    close(id) {
      const win = this.windows.get(id);
      if (!win)
        return;
      this.remove(id);
      this.windows.delete(id);
      const {
        id: _,
        ws: __,
        ...content
      } = win;
      this.closed.push(content);
      if (this.closed.length > REOPEN_DEPTH)
        this.closed.shift();
    }
    focusWin(id) {
      const win = this.windows.get(id);
      if (!win)
        return;
      this.active = win.ws;
      this.spaces[win.ws].focus = id;
      this.reveal(win.ws);
    }
    neighbor(dir) {
      const space = this.spaces[this.active];
      if (space.focus === null)
        return null;
      const all = this.placements().filter((p) => !p.hidden || p.id === space.focus);
      const from = all.find((p) => p.id === space.focus)?.rect;
      if (!from)
        return null;
      let best = null;
      for (const p of all) {
        if (p.id === space.focus)
          continue;
        const r = p.rect;
        const across = dir === "left" || dir === "right" ? Math.min(r.y + r.h, from.y + from.h) - Math.max(r.y, from.y) : Math.min(r.x + r.w, from.x + from.w) - Math.max(r.x, from.x);
        if (across <= 0)
          continue;
        const d = dir === "left" ? from.x - (r.x + r.w) : dir === "right" ? r.x - (from.x + from.w) : dir === "up" ? from.y - (r.y + r.h) : r.y - (from.y + from.h);
        if (d < -GAP_IN * 2)
          continue;
        if (!best || d < best.d)
          best = {
            id: p.id,
            d
          };
      }
      return best?.id ?? null;
    }
    focusDir(dir) {
      const next = this.neighbor(dir);
      if (next === null)
        return false;
      this.spaces[this.active].focus = next;
      this.reveal(this.active);
      return true;
    }
    swapDir(dir) {
      const space = this.spaces[this.active];
      const other = this.neighbor(dir);
      if (other === null || space.focus === null)
        return false;
      this.swap(space.focus, other);
      this.reveal(this.active);
      return true;
    }
    swap(a, b) {
      const wa = this.windows.get(a);
      const wb = this.windows.get(b);
      if (!wa || !wb || wa.ws !== wb.ws || a === b)
        return;
      const space = this.spaces[wa.ws];
      const other = (id) => id === a ? b : id === b ? a : id;
      const swapIn = (node) => {
        if (!node)
          return;
        if (node.kind === "leaf")
          node.win = other(node.win);
        else {
          swapIn(node.a);
          swapIn(node.b);
        }
      };
      swapIn(space.root);
      for (const column of space.columns)
        column.wins = column.wins.map(other);
    }
    parentOfFocus() {
      const space = this.spaces[this.active];
      return space.focus === null ? null : path(space.root, space.focus)?.at(-1) ?? null;
    }
    focusedColumn() {
      const space = this.spaces[this.active];
      return space.columns.find((c) => space.focus !== null && c.wins.includes(space.focus)) ?? null;
    }
    resize(delta) {
      if (this.layout() === "scrolling") {
        const column = this.focusedColumn();
        if (!column)
          return false;
        column.width = clamp(column.width + delta * RESIZE_STEP, MIN_COLUMN, 1);
        this.reveal(this.active);
        return true;
      }
      const parent = this.parentOfFocus();
      if (!parent)
        return false;
      const grow = parent.side === "a" ? delta : -delta;
      parent.split.ratio = clamp(parent.split.ratio + grow * RESIZE_STEP, MIN_RATIO, MAX_RATIO);
      return true;
    }
    resizeAxis(axis, dir) {
      if (this.layout() === "scrolling")
        return axis === "x" && this.resize(dir);
      const space = this.spaces[this.active];
      const chain = space.focus === null ? null : path(space.root, space.focus);
      const parent = chain ? [...chain].reverse().find((p) => p.split.axis === axis) : undefined;
      if (!parent)
        return false;
      const ratio = clamp(parent.split.ratio + dir * RESIZE_STEP, MIN_RATIO, MAX_RATIO);
      if (ratio === parent.split.ratio)
        return false;
      parent.split.ratio = ratio;
      return true;
    }
    toggleSplit() {
      if (this.layout() === "scrolling") {
        const column = this.focusedColumn();
        if (!column)
          return false;
        const at = COLUMN_WIDTHS.findIndex((w) => w > column.width + 0.01);
        column.width = COLUMN_WIDTHS[at < 0 ? 0 : at];
        this.reveal(this.active);
        return true;
      }
      const parent = this.parentOfFocus();
      if (!parent)
        return false;
      parent.split.axis = parent.split.axis === "x" ? "y" : "x";
      return true;
    }
    swapSplit() {
      const space = this.spaces[this.active];
      if (space.focus === null)
        return false;
      if (space.layout === "dwindle") {
        const parent = this.parentOfFocus();
        if (!parent)
          return false;
        [parent.split.a, parent.split.b] = [parent.split.b, parent.split.a];
        return true;
      }
      const ci = space.columns.findIndex((c) => c.wins.includes(space.focus));
      const column = space.columns[ci];
      if (column.wins.length > 1) {
        column.wins.splice(column.wins.indexOf(space.focus), 1);
        space.columns.splice(ci + 1, 0, {
          wins: [space.focus],
          width: column.width
        });
      } else if (ci > 0) {
        space.columns.splice(ci, 1);
        space.columns[ci - 1].wins.push(space.focus);
      } else
        return false;
      this.reveal(this.active);
      return true;
    }
    toggleFullscreen(mode) {
      const space = this.spaces[this.active];
      if (space.focus === null)
        return;
      space.fullscreen = space.fullscreen?.win === space.focus && space.fullscreen.mode === mode ? null : {
        win: space.focus,
        mode
      };
    }
    fullscreen(ws = this.active) {
      return this.spaces[ws].fullscreen;
    }
    toggleLayout(ws = this.active) {
      const space = this.spaces[ws];
      const order = this.order(ws);
      const focus = space.focus;
      space.fullscreen = null;
      if (space.layout === "dwindle") {
        space.layout = "scrolling";
        space.root = null;
        space.columns = order.map((id) => ({
          wins: [id],
          width: DEFAULT_COLUMN
        }));
        space.scroll = 0;
      } else {
        space.layout = "dwindle";
        space.columns = [];
        space.root = null;
        space.focus = null;
        for (const id of order)
          this.insert(ws, id);
      }
      space.focus = focus;
      this.reveal(ws);
      return space.layout;
    }
    pan(delta) {
      return this.panBy(delta * PAN_STEP);
    }
    panBy(points) {
      const space = this.spaces[this.active];
      if (space.layout !== "scrolling")
        return false;
      space.scroll = clamp(space.scroll + points, 0, this.maxScroll(this.active));
      return true;
    }
    maxScroll(ws) {
      const space = this.spaces[ws];
      const area = this.area();
      const total = space.columns.reduce((n, c) => n + Math.round(area.w * c.width), 0);
      return Math.max(0, total - area.w);
    }
    reveal(ws) {
      const space = this.spaces[ws];
      if (space.layout !== "scrolling")
        return;
      const area = this.area();
      let x = 0;
      for (const column of space.columns) {
        const w = Math.round(area.w * column.width);
        if (space.focus !== null && column.wins.includes(space.focus)) {
          if (x + w > space.scroll + area.w)
            space.scroll = x + w - area.w;
          if (x < space.scroll)
            space.scroll = x;
          break;
        }
        x += w;
      }
      space.scroll = clamp(space.scroll, 0, this.maxScroll(ws));
    }
    splitAt(x, y, tolerance) {
      const space = this.spaces[this.active];
      if (space.layout !== "dwindle" || !space.root)
        return null;
      const visit = (node, cell) => {
        if (node.kind === "leaf")
          return null;
        const [a, b] = halves(node, cell);
        const edge = node.axis === "x" ? b.x : b.y;
        const along = node.axis === "x" ? y >= cell.y && y < cell.y + cell.h : x >= cell.x && x < cell.x + cell.w;
        if (along && Math.abs((node.axis === "x" ? x : y) - edge) <= tolerance)
          return {
            split: node,
            cell
          };
        return visit(node.a, a) ?? visit(node.b, b);
      };
      return visit(space.root, this.area());
    }
    dragSplit(handle, x, y) {
      const {
        split,
        cell
      } = handle;
      split.ratio = clamp(split.axis === "x" ? (x - cell.x) / cell.w : (y - cell.y) / cell.h, MIN_RATIO, MAX_RATIO);
    }
    switchWs(ws) {
      this.active = wrap(ws);
    }
    stepWs(delta) {
      this.switchWs(this.active + delta);
    }
    moveToWs(id, ws) {
      const win = this.windows.get(id);
      const target = wrap(ws);
      if (!win || win.ws === target)
        return;
      this.remove(id);
      win.ws = target;
      this.insert(target, id);
    }
    carry(delta) {
      const space = this.spaces[this.active];
      if (space.focus === null)
        return false;
      const id = space.focus;
      this.moveToWs(id, this.active + delta);
      this.focusWin(id);
      return true;
    }
  }

  // shell/src/workspaces.ts
  var MOTION_MS = 200;
  var GHOST_MS = 170;
  var POP = 0.87;
  var SLIDE = 48;
  var WINDOW_ORIGIN = TOP_LEFT;
  var wm = new WindowManager;
  var [rev, setRev] = createSignal(0);
  var motions = new Map;
  var nodes = new Map;
  var [ghosts, setGhosts] = createSignal([]);
  var ghostKey = 0;
  var mix = (a, b, t) => a + (b - a) * t;
  var easeOut = (t) => 1 - (1 - t) ** 3;
  function drawnAt(m, now) {
    const e = easeOut(Math.min(1, Math.max(0, (now - m.start) / slowed(MOTION_MS))));
    return {
      rect: {
        x: mix(m.from.x, m.to.x, e),
        y: mix(m.from.y, m.to.y, e),
        w: mix(m.from.w, m.to.w, e),
        h: mix(m.from.h, m.to.h, e)
      },
      alpha: mix(m.fromAlpha, m.toAlpha, e)
    };
  }
  function play(node, m) {
    flip(node, m.from, m.to, m.fromAlpha, m.toAlpha, MOTION_MS);
  }
  function startMotion(id, m) {
    motions.set(id, m);
    const node = nodes.get(id);
    if (node)
      play(node, m);
  }
  var drawn = (id, now, fallback) => {
    const m = motions.get(id);
    return m ? drawnAt(m, now) : {
      rect: fallback.rect,
      alpha: fallback.hidden ? 0 : 1
    };
  };
  var shrink = (r, scale) => ({
    x: r.x + r.w * (1 - scale) / 2,
    y: r.y + r.h * (1 - scale) / 2,
    w: r.w * scale,
    h: r.h * scale
  });
  function bindWindow(id, node) {
    nodes.set(id, node);
    const m = motions.get(id);
    if (m) {
      const now = Date.now();
      const at = drawnAt(m, now);
      startMotion(id, {
        ...m,
        from: at.rect,
        fromAlpha: at.alpha,
        start: now
      });
    }
    return () => {
      if (nodes.get(id) === node)
        nodes.delete(id);
    };
  }
  function bindGhost(node) {
    const opts = {
      dur: slowed(GHOST_MS),
      easing: "linear"
    };
    animate(node, "scaleX", POP, opts);
    animate(node, "scaleY", POP, opts);
    animate(node, "opacity", 0, opts);
  }
  function act(change) {
    const now = Date.now();
    const ws = wm.active;
    const before = new Map(wm.placements().map((p) => [p.id, drawn(p.id, now, p)]));
    const out = change(wm);
    setRev((r) => r + 1);
    const placed = wm.placements();
    if (wm.active !== ws) {
      let delta = wm.active - ws;
      if (delta > WORKSPACES / 2)
        delta -= WORKSPACES;
      if (delta < -WORKSPACES / 2)
        delta += WORKSPACES;
      const dx = delta > 0 ? SLIDE : -SLIDE;
      for (const p of placed) {
        const from = before.get(p.id)?.rect ?? {
          ...p.rect,
          x: p.rect.x + dx
        };
        startMotion(p.id, {
          from,
          fromAlpha: before.has(p.id) ? 1 : 0,
          to: p.rect,
          toAlpha: p.hidden ? 0 : 1,
          start: now
        });
      }
    } else {
      for (const p of placed) {
        const toAlpha = p.hidden ? 0 : 1;
        const was = before.get(p.id);
        const m = motions.get(p.id);
        if (!was)
          startMotion(p.id, {
            from: shrink(p.rect, POP),
            fromAlpha: 0,
            to: p.rect,
            toAlpha,
            start: now
          });
        else if (!m || !sameRect(m.to, p.rect) || m.toAlpha !== toAlpha)
          startMotion(p.id, {
            from: was.rect,
            fromAlpha: was.alpha,
            to: p.rect,
            toAlpha,
            start: now
          });
      }
      const live = new Set(placed.map((p) => p.id));
      const gone = [];
      for (const [id, was] of before)
        if (!live.has(id) && was.alpha > 0.05)
          gone.push({
            key: ++ghostKey,
            rect: was.rect
          });
      if (gone.length) {
        setGhosts((g) => [...g, ...gone]);
        after(slowed(GHOST_MS) / 1000 + 0.05, () => setGhosts((g) => g.filter((x) => !gone.includes(x))));
      }
    }
    for (const id of [...motions.keys()])
      if (!wm.windows.has(id))
        motions.delete(id);
    return out;
  }
  var read = (get) => () => {
    rev();
    return get(wm);
  };
  var revision = rev;
  var current4 = read((m) => m.active);
  var focused2 = read((m) => m.focused());
  var placements = read((m) => m.placements());
  var layout = read((m) => m.layout());
  var occupied = (ws) => read((m) => m.occupied(ws))();
  var fullscreen = read((m) => m.fullscreen());
  var visibleWindows = read((m) => m.order().map((id) => m.windows.get(id)));
  var windowById = (id) => wm.windows.get(id) ?? null;
  var windowsOn = (ws) => read((m) => m.order(ws).map((id) => m.windows.get(id)))();
  var windowAt = (x, y) => wm.windowAt(x, y);
  var takeClosed = () => wm.closed.pop() ?? null;
  var barPosition = read((m) => m.bar);
  function find(match) {
    return wm.find(match);
  }
  function open(content) {
    return act((m) => m.open(content));
  }
  function closeWindow(id) {
    act((m) => m.close(id));
  }
  function focusWindow(id) {
    act((m) => m.focusWin(id));
  }
  function focus(ws) {
    act((m) => m.switchWs(ws));
  }

  // shell/src/applets/applet.ts
  var registry2 = new Map;
  function register(applet) {
    registry2.set(applet.id, applet);
  }
  var applets = () => [...registry2.values()];
  var appletById = (id) => registry2.get(id);
  var appletOf = (w) => w?.kind === "applet" ? registry2.get(w.applet) : undefined;
  var isApplet = (id) => (w) => w.kind === "applet" && w.applet === id;
  function openApplet(id) {
    if (!registry2.has(id))
      return;
    const existing = find(isApplet(id));
    if (existing)
      return focusWindow(existing.id);
    open({
      kind: "applet",
      applet: id
    });
  }

  // daemon/protocol.ts
  var TERM_COLS = 80;
  var TERM_ROWS = 26;
  function needsRuntimeGlyph(cp) {
    if (cp <= 126 || cp >= 160 && cp <= 255)
      return false;
    if (cp >= 8208 && cp <= 8286 || cp >= 8592 && cp <= 8703 || cp >= 9472 && cp <= 9631 || cp >= 10240 && cp <= 10495)
      return false;
    return cp >= 256;
  }
  var CJK_SLOT_12 = 21;
  var CJK_SLOT_14 = 22;

  // shell/src/glyphs.ts
  var [generation, setGeneration] = createSignal(0);
  var asked = new Set;
  function needsRuntime(text) {
    for (const ch of text)
      if (needsRuntimeGlyph(ch.codePointAt(0)))
        return true;
    return false;
  }
  function load(atlases) {
    const bridge = globalThis.omarchyBridge;
    for (const atlas of atlases)
      bridge?.loadFontAtlas(atlas.path);
    setGeneration((g) => g + 1);
  }
  function cjk(text, slot) {
    generation();
    if (!needsRuntime(text))
      return {};
    if (!asked.has(text)) {
      asked.add(text);
      request({
        method: "glyphs",
        text
      });
    }
    return {
      fontSlot: slot
    };
  }
  onEvent((event) => {
    if (event.event === "atlas")
      load(event.atlases);
    else if (event.event === "hello") {
      asked.clear();
      request({
        method: "atlases"
      }).then(load, () => {});
    }
  });

  // shell/src/classes.ts
  var C = {
    bar: "absolute left-0 top-0 w-[512] h-[18] contain-strict",
    barText: "absolute top-[2] font-mono text-xs leading-[14]",
    barCenter: "absolute left-0 top-[2] w-[512] text-center font-mono text-xs leading-[14]",
    barRight: "absolute right-[8] top-[2] font-mono text-xs leading-[14]",
    deck: "absolute left-0 top-0 w-[512] h-[350] contain-strict",
    card: "absolute left-0 top-0 w-[360] h-[296] contain-strict",
    cardRule: "absolute left-[8] top-[25] w-[344] h-[1]",
    crumbs: "absolute left-[12] top-[6] font-mono text-sm leading-[16]",
    rule: "absolute left-[8] top-[25] w-[496] h-[1]",
    row: "absolute left-[8] w-[496] h-[22]",
    rowOn: "absolute left-0 top-0 w-[496] h-[22] rounded-sm",
    icon: "absolute left-[8] top-[4] w-[20] font-mono text-sm leading-[14]",
    label: "absolute left-[34] top-[4] font-mono text-sm leading-[14]",
    chevron: "absolute right-[8] top-[4] font-mono text-sm leading-[14]",
    footer: "absolute left-0 top-[298] w-[512] h-[20]",
    hint: "absolute left-[12] top-[3] font-mono text-xs leading-[14]",
    osd: "absolute top-[288] h-[48] overflow-hidden rounded-md border-[1]",
    osdIcon: "absolute left-[12] top-[10] w-[28] text-center text-2xl leading-[28]",
    osdTrack: "absolute left-[52] top-[22] w-[120] h-[4]",
    osdValue: "absolute right-[12] top-[15] font-mono text-base leading-[18]",
    osdMessage: "absolute left-[48] top-[15] font-mono text-base leading-[18]",
    toast: "absolute right-[8] w-[248] h-[52] overflow-hidden rounded-md border-[1]",
    toastIcon: "absolute left-[10] top-[8] w-[18] font-mono text-sm leading-[16]",
    toastTitle: "absolute left-[32] top-[8] w-[136] h-[16] overflow-hidden font-mono text-sm leading-[16]",
    toastKeys: "absolute right-[8] top-[9] font-mono text-xs leading-[14]",
    toastBody: "absolute left-[32] top-[28] w-[206] h-[16] overflow-hidden font-mono text-xs leading-[14]",
    cover: "absolute left-0 top-0 w-[512] h-[384]",
    lockIcon: "absolute left-0 top-[118] w-[512] text-center text-2xl leading-[28]",
    lockClock: "absolute left-0 top-[160] w-[512] text-center text-2xl leading-[28]",
    lockDate: "absolute left-0 top-[202] w-[512] text-center font-mono text-sm leading-[16]"
  };

  // shell/src/generated/menu.ts
  var MENU = [{
    id: "apps",
    icon: "\uDB80\uDC3B",
    label: "Apps",
    title: "Apps",
    action: "omarchy-shell omarchy.dock apps",
    provider: "apps",
    when: "",
    checked: "",
    disabled: "",
    children: []
  }, {
    id: "learn",
    icon: "\uDB82\uDDD1",
    label: "Learn",
    title: "Learn",
    action: "",
    provider: "",
    when: "",
    checked: "",
    disabled: "",
    children: [{
      id: "learn.keybindings",
      icon: "",
      label: "Keybindings",
      title: "Keybindings",
      action: "omarchy-menu-keybindings",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "learn.omarchy",
      icon: "",
      label: "Omarchy",
      title: "Omarchy",
      action: "omarchy-launch-webapp 'https://omarchy.org/manual/'",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "learn.hyprland",
      icon: "",
      label: "Hyprland",
      title: "Hyprland",
      action: "omarchy-launch-webapp 'https://wiki.hypr.land/'",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "learn.arch",
      icon: "\uDB82\uDCC7",
      label: "Arch",
      title: "Arch",
      action: "omarchy-launch-webapp 'https://wiki.archlinux.org/title/Main_page'",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "learn.neovim",
      icon: "",
      label: "Neovim",
      title: "Neovim",
      action: "omarchy-launch-webapp 'https://www.lazyvim.org/keymaps'",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "learn.bash",
      icon: "\uDB84\uDD83",
      label: "Bash",
      title: "Bash",
      action: "omarchy-launch-webapp 'https://devhints.io/bash'",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "learn.tmux-keybindings",
      icon: "",
      label: "Tmux",
      title: "Tmux",
      action: "omarchy-menu-tmux-keybindings",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "learn.herdr-keybindings",
      icon: "",
      label: "Herdr",
      title: "Herdr",
      action: "omarchy-menu-herdr-keybindings",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "learn.community",
      icon: "\uDB81\uDE6F",
      label: "Community",
      title: "Community",
      action: "omarchy-launch-discord-community",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }]
  }, {
    id: "appearance",
    icon: "\uDB80\uDFD8",
    label: "Appearance",
    title: "Appearance",
    action: "",
    provider: "",
    when: "",
    checked: "",
    disabled: "",
    children: [{
      id: "appearance.theme",
      icon: "\uDB83\uDE0C",
      label: "Theme",
      title: "Theme",
      action: `omarchy-shell shell summon omarchy.image-picker '{"source":"themes"}'`,
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "appearance.background",
      icon: "",
      label: "Background",
      title: "Background",
      action: 'background=$(omarchy-theme-bg-switcher); [[ -n $background ]] && omarchy-theme-bg-set "$background"',
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "appearance.font",
      icon: "",
      label: "Font",
      title: "Font",
      action: "",
      provider: "fonts",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "appearance.top-bar",
      icon: "\uDB80\uDF5C",
      label: "Menu Bar",
      title: "Menu Bar",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "appearance.top-bar.hide",
        icon: "\uDB80\uDE09",
        label: "Hide Bar",
        title: "Hide Bar",
        action: "omarchy-toggle-bar",
        provider: "",
        when: "! omarchy-toggle-enabled bar-off",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "appearance.top-bar.show",
        icon: "\uDB80\uDE08",
        label: "Show Bar",
        title: "Show Bar",
        action: "omarchy-toggle-bar",
        provider: "",
        when: "omarchy-toggle-enabled bar-off",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "appearance.top-bar.position",
        icon: "",
        label: "Position Bar",
        title: "Position Bar",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "appearance.top-bar.position.top",
          icon: "\uDB80\uDC5D",
          label: "Top Bar",
          title: "Top Bar",
          action: "omarchy-bar position top",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "appearance.top-bar.position.bottom",
          icon: "\uDB80\uDC45",
          label: "Bottom Bar",
          title: "Bottom Bar",
          action: "omarchy-bar position bottom",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "appearance.top-bar.position.left",
          icon: "\uDB80\uDC4D",
          label: "Left Bar",
          title: "Left Bar",
          action: "omarchy-bar position left",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "appearance.top-bar.position.right",
          icon: "\uDB80\uDC54",
          label: "Right Bar",
          title: "Right Bar",
          action: "omarchy-bar position right",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }]
      }, {
        id: "appearance.top-bar.background",
        icon: "\uDB80\uDCB5",
        label: "Bar Background",
        title: "Bar Background",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "appearance.top-bar.background.opaque",
          icon: "\uDB81\uDF64",
          label: "Opaque Bar",
          title: "Opaque Bar",
          action: "omarchy-bar background opaque",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-bar background) == "opaque" ]]',
          disabled: "",
          children: []
        }, {
          id: "appearance.top-bar.background.glassy",
          icon: "\uDB80\uDCB5",
          label: "Glassy Bar",
          title: "Glassy Bar",
          action: "omarchy-bar background glassy",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-bar background) == "glassy" ]]',
          disabled: "",
          children: []
        }, {
          id: "appearance.top-bar.background.clear",
          icon: "\uDB81\uDF63",
          label: "Clear Bar",
          title: "Clear Bar",
          action: "omarchy-bar background none",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-bar background) == "none" ]]',
          disabled: "",
          children: []
        }]
      }, {
        id: "appearance.top-bar.indicators",
        icon: "\uDB80\uDEFD",
        label: "Bar Indicators",
        title: "Bar Indicators",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "appearance.top-bar.indicators.battery-percentage-on",
          icon: "\uDB80\uDC79",
          label: "Show Battery %",
          title: "Show Battery %",
          action: "omarchy-shell omarchy.power togglePercentage",
          provider: "",
          when: "omarchy-hw-laptop && [[ $(omarchy-bar get omarchy.power showPercentage) != true ]]",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "appearance.top-bar.indicators.battery-percentage-off",
          icon: "\uDB80\uDC79",
          label: "Hide Battery %",
          title: "Hide Battery %",
          action: "omarchy-shell omarchy.power togglePercentage",
          provider: "",
          when: "omarchy-hw-laptop && [[ $(omarchy-bar get omarchy.power showPercentage) == true ]]",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "appearance.top-bar.indicators.clock",
          icon: "\uDB82\uDD54",
          label: "Clock",
          title: "Clock",
          action: "",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: [{
            id: "appearance.top-bar.indicators.clock.sunday-24h",
            icon: "\uDB82\uDD54",
            label: "Sunday 14:30",
            title: "Sunday 14:30",
            action: 'omarchy-bar set omarchy.clock format "dddd HH:mm"',
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: '[[ $(omarchy-bar get omarchy.clock format) == "dddd HH:mm" ]]',
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.sunday-12h",
            icon: "\uDB82\uDD54",
            label: "Sunday 2:30 PM",
            title: "Sunday 2:30 PM",
            action: 'omarchy-bar set omarchy.clock format "dddd h:mm AP"',
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: '[[ $(omarchy-bar get omarchy.clock format) == "dddd h:mm AP" ]]',
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.sunday-seconds-24h",
            icon: "\uDB82\uDD54",
            label: "Sunday 14:30:05",
            title: "Sunday 14:30:05",
            action: 'omarchy-bar set omarchy.clock format "dddd HH:mm:ss"',
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: '[[ $(omarchy-bar get omarchy.clock format) == "dddd HH:mm:ss" ]]',
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.sunday-seconds-12h",
            icon: "\uDB82\uDD54",
            label: "Sunday 2:30:05 PM",
            title: "Sunday 2:30:05 PM",
            action: 'omarchy-bar set omarchy.clock format "dddd h:mm:ss AP"',
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: '[[ $(omarchy-bar get omarchy.clock format) == "dddd h:mm:ss AP" ]]',
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.time-24h",
            icon: "\uDB82\uDD54",
            label: "14:30",
            title: "14:30",
            action: 'omarchy-bar set omarchy.clock format "HH:mm"',
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: '[[ $(omarchy-bar get omarchy.clock format) == "HH:mm" ]]',
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.time-12h",
            icon: "\uDB82\uDD54",
            label: "2:30 PM",
            title: "2:30 PM",
            action: 'omarchy-bar set omarchy.clock format "h:mm AP"',
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: '[[ $(omarchy-bar get omarchy.clock format) == "h:mm AP" ]]',
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.date-24h",
            icon: "\uDB82\uDD54",
            label: "Sun 3 May 14:30",
            title: "Sun 3 May 14:30",
            action: 'omarchy-bar set omarchy.clock format "ddd d MMM HH:mm"',
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: '[[ $(omarchy-bar get omarchy.clock format) == "ddd d MMM HH:mm" ]]',
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.date-12h",
            icon: "\uDB82\uDD54",
            label: "Sun 3 May 2:30 PM",
            title: "Sun 3 May 2:30 PM",
            action: 'omarchy-bar set omarchy.clock format "ddd d MMM h:mm AP"',
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: '[[ $(omarchy-bar get omarchy.clock format) == "ddd d MMM h:mm AP" ]]',
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.week",
            icon: "\uDB82\uDD54",
            label: "3 May W18 2026",
            title: "3 May W18 2026",
            action: `omarchy-bar set omarchy.clock format "d MMMM 'W'ww yyyy"`,
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: `[[ $(omarchy-bar get omarchy.clock format) == "d MMMM 'W'ww yyyy" ]]`,
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.iso",
            icon: "\uDB82\uDD54",
            label: "2026-05-03 14:30",
            title: "2026-05-03 14:30",
            action: 'omarchy-bar set omarchy.clock format "yyyy-MM-dd HH:mm"',
            provider: "",
            when: '[[ $(omarchy-bar position) != "left" && $(omarchy-bar position) != "right" ]]',
            checked: '[[ $(omarchy-bar get omarchy.clock format) == "yyyy-MM-dd HH:mm" ]]',
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.stacked-24h",
            icon: "\uDB82\uDD54",
            label: "14 — 30",
            title: "14 — 30",
            action: "omarchy-bar set omarchy.clock verticalFormat $'HH\\n—\\nmm'",
            provider: "",
            when: '[[ $(omarchy-bar position) == "left" || $(omarchy-bar position) == "right" ]]',
            checked: "[[ $(omarchy-bar get omarchy.clock verticalFormat) == $'HH\\n—\\nmm' ]]",
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.stacked-12h",
            icon: "\uDB82\uDD54",
            label: "2 — 30 PM",
            title: "2 — 30 PM",
            action: "omarchy-bar set omarchy.clock verticalFormat $'h\\n—\\nmm\\nAP'",
            provider: "",
            when: '[[ $(omarchy-bar position) == "left" || $(omarchy-bar position) == "right" ]]',
            checked: "[[ $(omarchy-bar get omarchy.clock verticalFormat) == $'h\\n—\\nmm\\nAP' ]]",
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.stacked-date",
            icon: "\uDB82\uDD54",
            label: "03 May W18 '26",
            title: "03 May W18 '26",
            action: "omarchy-bar set omarchy.clock verticalFormat $'dd\\nMMM\\n\\'W\\'ww\\n\\'\\'yy'",
            provider: "",
            when: '[[ $(omarchy-bar position) == "left" || $(omarchy-bar position) == "right" ]]',
            checked: "[[ $(omarchy-bar get omarchy.clock verticalFormat) == $'dd\\nMMM\\n\\'W\\'ww\\n\\'\\'yy' ]]",
            disabled: "",
            children: []
          }, {
            id: "appearance.top-bar.indicators.clock.stacked-time",
            icon: "\uDB82\uDD54",
            label: "14 30",
            title: "14 30",
            action: "omarchy-bar set omarchy.clock verticalFormat $'HH\\nmm'",
            provider: "",
            when: '[[ $(omarchy-bar position) == "left" || $(omarchy-bar position) == "right" ]]',
            checked: "[[ $(omarchy-bar get omarchy.clock verticalFormat) == $'HH\\nmm' ]]",
            disabled: "",
            children: []
          }]
        }]
      }]
    }, {
      id: "appearance.windows",
      icon: "\uDB81\uDDB2",
      label: "Windows",
      title: "Windows",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "appearance.windows.gaps-on",
        icon: "",
        label: "Window Gaps On",
        title: "Window Gaps On",
        action: "omarchy-hyprland-window-gaps-toggle",
        provider: "",
        when: "omarchy-hyprland-toggle-enabled window-no-gaps",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "appearance.windows.gaps-off",
        icon: "",
        label: "Window Gaps Off",
        title: "Window Gaps Off",
        action: "omarchy-hyprland-window-gaps-toggle",
        provider: "",
        when: "! omarchy-hyprland-toggle-enabled window-no-gaps",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "appearance.windows.corners",
        icon: "\uDB81\uDE07",
        label: "Window Corners",
        title: "Window Corners",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "appearance.windows.corners.theme",
          icon: "\uDB80\uDFD8",
          label: "Theme Corners",
          title: "Theme Corners",
          action: "omarchy-hyprland-corners theme",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-hyprland-corners) == "theme" ]]',
          disabled: "",
          children: []
        }, {
          id: "appearance.windows.corners.sharp",
          icon: "\uDB81\uDF63",
          label: "Sharp Corners",
          title: "Sharp Corners",
          action: "omarchy-hyprland-corners sharp",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-hyprland-corners) == "sharp" ]]',
          disabled: "",
          children: []
        }, {
          id: "appearance.windows.corners.rounded",
          icon: "\uDB81\uDE07",
          label: "Rounded Corners",
          title: "Rounded Corners",
          action: "omarchy-hyprland-corners rounded",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-hyprland-corners) == "rounded" ]]',
          disabled: "",
          children: []
        }]
      }, {
        id: "appearance.windows.transparency",
        icon: "\uDB80\uDCB5",
        label: "Window Opacity",
        title: "Window Opacity",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "appearance.windows.transparency.opaque",
          icon: "\uDB81\uDF64",
          label: "Opaque Windows",
          title: "Opaque Windows",
          action: "omarchy-hyprland-window-transparency opaque",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-hyprland-window-transparency) == "opaque" ]]',
          disabled: "",
          children: []
        }, {
          id: "appearance.windows.transparency.transparent",
          icon: "\uDB81\uDF63",
          label: "Transparent Windows",
          title: "Transparent Windows",
          action: "omarchy-hyprland-window-transparency transparent",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-hyprland-window-transparency) == "transparent" ]]',
          disabled: "",
          children: []
        }, {
          id: "appearance.windows.transparency.glassy",
          icon: "\uDB80\uDCB5",
          label: "Glassy Windows",
          title: "Glassy Windows",
          action: "omarchy-hyprland-window-transparency glassy",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-hyprland-window-transparency) == "glassy" ]]',
          disabled: "",
          children: []
        }]
      }, {
        id: "appearance.windows.one-window-ratio-on",
        icon: "",
        label: "1-Window Ratio On",
        title: "1-Window Ratio On",
        action: "omarchy-hyprland-window-single-square-aspect-toggle",
        provider: "",
        when: "! omarchy-hyprland-toggle-enabled single-window-aspect-ratio",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "appearance.windows.one-window-ratio-off",
        icon: "",
        label: "1-Window Ratio Off",
        title: "1-Window Ratio Off",
        action: "omarchy-hyprland-window-single-square-aspect-toggle",
        provider: "",
        when: "omarchy-hyprland-toggle-enabled single-window-aspect-ratio",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "appearance.branding",
      icon: "",
      label: "Branding",
      title: "Branding",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "appearance.branding.screensaver",
        icon: "\uDB84\uDD04",
        label: "Screensaver",
        title: "Screensaver",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "appearance.branding.screensaver.text",
          icon: "",
          label: "Edit Text",
          title: "Edit Text",
          action: "omarchy-branding-screensaver text",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "appearance.branding.screensaver.image",
          icon: "",
          label: "Set From Image",
          title: "Set From Image",
          action: "omarchy-branding-screensaver image",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "appearance.branding.screensaver.default",
          icon: "",
          label: "Restore Default",
          title: "Restore Default",
          action: "omarchy-branding-screensaver reset",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }]
      }, {
        id: "appearance.branding.about",
        icon: "",
        label: "About",
        title: "About",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "appearance.branding.about.text",
          icon: "",
          label: "Edit Text",
          title: "Edit Text",
          action: "omarchy-branding-about text",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "appearance.branding.about.image",
          icon: "",
          label: "Set From Image",
          title: "Set From Image",
          action: "omarchy-branding-about image",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "appearance.branding.about.default",
          icon: "",
          label: "Restore Default",
          title: "Restore Default",
          action: "omarchy-branding-about reset",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }]
      }]
    }, {
      id: "appearance.dock",
      icon: "\uDB84\uDCA9",
      label: "Dock",
      title: "Dock",
      action: "",
      provider: "",
      when: '[[ $(omarchy-hyprland-workspace-layout-current) == "floating" ]]',
      checked: "",
      disabled: "",
      children: [{
        id: "appearance.dock.autohide",
        icon: "\uDB80\uDE09",
        label: "Auto-hide Dock",
        title: "Auto-hide Dock",
        action: "omarchy-dock autohide on",
        provider: "",
        when: '[[ $(omarchy-dock autohide) == "off" ]]',
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "appearance.dock.always-on",
        icon: "\uDB80\uDE08",
        label: "Always-on Dock",
        title: "Always-on Dock",
        action: "omarchy-dock autohide off",
        provider: "",
        when: '[[ $(omarchy-dock autohide) == "on" ]]',
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "appearance.dock.position",
        icon: "",
        label: "Dock Position",
        title: "Dock Position",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "appearance.dock.position.top",
          icon: "\uDB80\uDC5D",
          label: "Top Dock",
          title: "Top Dock",
          action: "omarchy-dock position top",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-dock position) == "top" ]]',
          disabled: "",
          children: []
        }, {
          id: "appearance.dock.position.bottom",
          icon: "\uDB80\uDC45",
          label: "Bottom Dock",
          title: "Bottom Dock",
          action: "omarchy-dock position bottom",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-dock position) == "bottom" ]]',
          disabled: "",
          children: []
        }, {
          id: "appearance.dock.position.left",
          icon: "\uDB80\uDC4D",
          label: "Left Dock",
          title: "Left Dock",
          action: "omarchy-dock position left",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-dock position) == "left" ]]',
          disabled: "",
          children: []
        }, {
          id: "appearance.dock.position.right",
          icon: "\uDB80\uDC54",
          label: "Right Dock",
          title: "Right Dock",
          action: "omarchy-dock position right",
          provider: "",
          when: "",
          checked: '[[ $(omarchy-dock position) == "right" ]]',
          disabled: "",
          children: []
        }]
      }]
    }, {
      id: "appearance.workspace-layout",
      icon: "\uDB84\uDCAC",
      label: "Workspace Layout",
      title: "Default Workspace Layout",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "appearance.workspace-layout.dwindle",
        icon: "\uDB85\uDCFB",
        label: "Tiling",
        title: "Tiling",
        action: "omarchy-hyprland-workspace-layout-default dwindle",
        provider: "",
        when: "",
        checked: '[[ $(omarchy-hyprland-workspace-layout-default) == "dwindle" ]]',
        disabled: "",
        children: []
      }, {
        id: "appearance.workspace-layout.scrolling",
        icon: "\uDB81\uDF65",
        label: "Scrolling",
        title: "Scrolling",
        action: "omarchy-hyprland-workspace-layout-default scrolling",
        provider: "",
        when: "",
        checked: '[[ $(omarchy-hyprland-workspace-layout-default) == "scrolling" ]]',
        disabled: "",
        children: []
      }, {
        id: "appearance.workspace-layout.floating",
        icon: "\uDB81\uDD36",
        label: "Floating",
        title: "Floating",
        action: "omarchy-hyprland-workspace-layout-default floating",
        provider: "",
        when: "",
        checked: '[[ $(omarchy-hyprland-workspace-layout-default) == "floating" ]]',
        disabled: "",
        children: []
      }]
    }, {
      id: "appearance.animations-on",
      icon: "\uDB81\uDDD8",
      label: "Animations On",
      title: "Animations On",
      action: "omarchy-toggle-animations",
      provider: "",
      when: "omarchy-hyprland-toggle-enabled no-animations",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "appearance.animations-off",
      icon: "\uDB81\uDDD8",
      label: "Animations Off",
      title: "Animations Off",
      action: "omarchy-toggle-animations",
      provider: "",
      when: "! omarchy-hyprland-toggle-enabled no-animations",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "appearance.unlock",
      icon: "\uDB81\uDFF5",
      label: "Unlock",
      title: "Unlock",
      action: 'unlock=$(omarchy-plymouth-switcher); if [[ $unlock == default ]]; then omarchy-launch-floating-terminal-with-presentation omarchy-plymouth-reset; elif [[ -n $unlock ]]; then omarchy-launch-floating-terminal-with-presentation "omarchy-plymouth-set-by-theme $(printf %q "$unlock")"; fi',
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }]
  }, {
    id: "trigger",
    icon: "\uDB85\uDCDE",
    label: "Trigger",
    title: "Trigger",
    action: "",
    provider: "",
    when: "",
    checked: "",
    disabled: "",
    children: [{
      id: "trigger.toggle",
      icon: "\uDB81\uDD0E",
      label: "Toggle",
      title: "Toggle",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "trigger.toggle.idle-lock-on",
        icon: "",
        label: "Stay Awake",
        title: "Stay Awake",
        action: "omarchy-toggle-idle",
        provider: "",
        when: "[[ ! -f ~/.local/state/omarchy/indicators/stay-awake ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.toggle.idle-lock-off",
        icon: "",
        label: "Allow Sleep",
        title: "Allow Sleep",
        action: "omarchy-toggle-idle",
        provider: "",
        when: "[[ -f ~/.local/state/omarchy/indicators/stay-awake ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.toggle.notifications-on",
        icon: "\uDB80\uDC9B",
        label: "Notifications On",
        title: "Notifications On",
        action: "omarchy-toggle-notification-silencing",
        provider: "",
        when: "[[ $(omarchy-shell notifications isDnd) == on ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.toggle.notifications-off",
        icon: "\uDB80\uDC9B",
        label: "Silence Notifications",
        title: "Silence Notifications",
        action: "omarchy-toggle-notification-silencing",
        provider: "",
        when: "[[ $(omarchy-shell notifications isDnd) != on ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.toggle.nightlight-on",
        icon: "\uDB81\uDD0E",
        label: "Nightlight On",
        title: "Nightlight On",
        action: "omarchy-toggle-nightlight",
        provider: "",
        when: `[[ $(omarchy-toggle-nightlight --status) != *'"enabled":true'* ]]`,
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.toggle.nightlight-off",
        icon: "\uDB81\uDD0E",
        label: "Nightlight Off",
        title: "Nightlight Off",
        action: "omarchy-toggle-nightlight",
        provider: "",
        when: `[[ $(omarchy-toggle-nightlight --status) == *'"enabled":true'* ]]`,
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.toggle.screensaver-on",
        icon: "\uDB84\uDD04",
        label: "Screensaver On",
        title: "Screensaver On",
        action: "omarchy-toggle-screensaver",
        provider: "",
        when: "omarchy-toggle-enabled screensaver-off",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.toggle.screensaver-off",
        icon: "\uDB84\uDD04",
        label: "Screensaver Off",
        title: "Screensaver Off",
        action: "omarchy-toggle-screensaver",
        provider: "",
        when: "! omarchy-toggle-enabled screensaver-off",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.toggle.crash-capture-on",
        icon: "\uDB85\uDEA1",
        label: "Crash Capture On",
        title: "Crash Capture On",
        action: "omarchy-toggle-crash-capture",
        provider: "",
        when: "omarchy-toggle-enabled crash-capture-off",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.toggle.crash-capture-off",
        icon: "\uDB85\uDEA1",
        label: "Crash Capture Off",
        title: "Crash Capture Off",
        action: "omarchy-toggle-crash-capture",
        provider: "",
        when: "! omarchy-toggle-enabled crash-capture-off",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "trigger.emoji",
      icon: "",
      label: "Emoji",
      title: "Emoji",
      action: "omarchy-menu-emoji",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "trigger.clipboard-history",
      icon: "\uDB80\uDD47",
      label: "Clipboard History",
      title: "Clipboard History",
      action: "omarchy-shell shell summon omarchy.clipboard",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "trigger.reminder",
      icon: "\uDB82\uDC8C",
      label: "Reminder",
      title: "Reminder",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "trigger.reminder.set",
        icon: "\uDB82\uDC8C",
        label: "Set one",
        title: "Set one",
        action: "omarchy-reminder -i",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.reminder.show",
        icon: "\uDB82\uDC8C",
        label: "Show all",
        title: "Show all",
        action: "omarchy-reminder show",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.reminder.clear",
        icon: "\uDB82\uDC8C",
        label: "Clear all",
        title: "Clear all",
        action: "omarchy-reminder clear",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "trigger.capture",
      icon: "",
      label: "Capture",
      title: "Capture",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "trigger.capture.screenshot",
        icon: "",
        label: "Screenshot",
        title: "Screenshot",
        action: "omarchy-capture-screenshot",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.capture.screenrecord",
        icon: "",
        label: "Screenrecord",
        title: "Screenrecord",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "trigger.capture.screenrecord.no-audio",
          icon: "",
          label: "With no audio",
          title: "With no audio",
          action: "omarchy-capture-screenrecording",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "trigger.capture.screenrecord.desktop-audio",
          icon: "",
          label: "With desktop audio",
          title: "With desktop audio",
          action: "omarchy-capture-screenrecording --with-desktop-audio",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "trigger.capture.screenrecord.microphone",
          icon: "",
          label: "With desktop + microphone audio",
          title: "With desktop + microphone audio",
          action: "omarchy-capture-screenrecording --with-desktop-audio --with-microphone-audio",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "trigger.capture.screenrecord.webcam",
          icon: "",
          label: "With desktop + microphone audio + webcam",
          title: "With desktop + microphone audio + webcam",
          action: "omarchy-capture-screenrecording-with-webcam",
          provider: "",
          when: "omarchy-hw-webcam",
          checked: "",
          disabled: "",
          children: []
        }]
      }, {
        id: "trigger.capture.text",
        icon: "\uDB83\uDD11",
        label: "Text",
        title: "Text",
        action: "omarchy-capture-text",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.capture.qr",
        icon: "\uDB81\uDC32",
        label: "QR Code",
        title: "QR Code",
        action: "omarchy-capture-qr",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.capture.color",
        icon: "\uDB80\uDCC9",
        label: "Color",
        title: "Color",
        action: "pkill hyprpicker || hyprpicker -a",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "trigger.transcode",
      icon: "\uDB82\uDDF8",
      label: "Transcode",
      title: "Transcode",
      action: "omarchy-transcode",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "trigger.share",
      icon: "",
      label: "Share",
      title: "Share",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "trigger.share.clipboard",
        icon: "",
        label: "Clipboard",
        title: "Clipboard",
        action: "omarchy-menu-share clipboard",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.share.file",
        icon: "",
        label: "File",
        title: "File",
        action: "omarchy-menu-share file",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.share.folder",
        icon: "",
        label: "Folder",
        title: "Folder",
        action: "omarchy-menu-share folder",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.share.receive",
        icon: "\uDB82\uDD66",
        label: "Receive",
        title: "Receive",
        action: "uwsm-app -- localsend",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "trigger.hardware",
      icon: "",
      label: "Hardware",
      title: "Hardware",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "trigger.hardware.laptop-display-on",
        icon: "\uDB81\uDEE7",
        label: "Laptop Display On",
        title: "Laptop Display On",
        action: "omarchy-hyprland-monitor-internal toggle",
        provider: "",
        when: "omarchy-hw-laptop && omarchy-hyprland-toggle-enabled internal-monitor-disable",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.hardware.laptop-display-off",
        icon: "\uDB81\uDEE7",
        label: "Laptop Display Off",
        title: "Laptop Display Off",
        action: "omarchy-hyprland-monitor-internal toggle",
        provider: "",
        when: "omarchy-hw-laptop && ! omarchy-hyprland-toggle-enabled internal-monitor-disable",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.hardware.mirror-display-on",
        icon: "\uDB80\uDF79",
        label: "Display Mirroring On",
        title: "Display Mirroring On",
        action: "omarchy-hyprland-monitor-internal-mirror toggle",
        provider: "",
        when: "omarchy-hw-laptop && ! omarchy-hyprland-toggle-enabled internal-monitor-mirror",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.hardware.mirror-display-off",
        icon: "\uDB80\uDF79",
        label: "Display Mirroring Off",
        title: "Display Mirroring Off",
        action: "omarchy-hyprland-monitor-internal-mirror toggle",
        provider: "",
        when: "omarchy-hw-laptop && omarchy-hyprland-toggle-enabled internal-monitor-mirror",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.hardware.hybrid-gpu-on",
        icon: "",
        label: "Switch to Hybrid GPU",
        title: "Switch to Hybrid GPU",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-toggle-hybrid-gpu",
        provider: "",
        when: `omarchy-hw-hybrid-gpu && ! grep -q '"mode": "Hybrid"' /etc/supergfxd.conf`,
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.hardware.hybrid-gpu-off",
        icon: "",
        label: "Switch to Integrated GPU",
        title: "Switch to Integrated GPU",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-toggle-hybrid-gpu",
        provider: "",
        when: `omarchy-hw-hybrid-gpu && grep -q '"mode": "Hybrid"' /etc/supergfxd.conf`,
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.hardware.touchpad-on",
        icon: "\uDB81\uDFF8",
        label: "Enable Touchpad",
        title: "Enable Touchpad",
        action: "omarchy-toggle-touchpad",
        provider: "",
        when: "omarchy-hw-touchpad && [[ -f ~/.local/state/omarchy/toggles/hypr/touchpad-disabled-name ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.hardware.touchpad-off",
        icon: "\uDB81\uDFF8",
        label: "Disable Touchpad",
        title: "Disable Touchpad",
        action: "omarchy-toggle-touchpad",
        provider: "",
        when: "omarchy-hw-touchpad && [[ ! -f ~/.local/state/omarchy/toggles/hypr/touchpad-disabled-name ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.hardware.touchpad-haptics",
        icon: "\uDB80\uDF0C",
        label: "Touchpad Haptics",
        title: "Touchpad Haptics",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "trigger.hardware.touchpad-haptics.low",
          icon: "\uDB80\uDF0C",
          label: "low",
          title: "low",
          action: "dell-xps-touchpad-haptics set low",
          provider: "",
          when: "omarchy-hw-dell-xps-haptic-touchpad && omarchy-cmd-present dell-xps-touchpad-haptics",
          checked: '[[ "$(dell-xps-touchpad-haptics get)" == "low" ]]',
          disabled: "",
          children: []
        }, {
          id: "trigger.hardware.touchpad-haptics.mid",
          icon: "\uDB80\uDF0C",
          label: "mid",
          title: "mid",
          action: "dell-xps-touchpad-haptics set mid",
          provider: "",
          when: "omarchy-hw-dell-xps-haptic-touchpad && omarchy-cmd-present dell-xps-touchpad-haptics",
          checked: '[[ "$(dell-xps-touchpad-haptics get)" == "mid" ]]',
          disabled: "",
          children: []
        }, {
          id: "trigger.hardware.touchpad-haptics.high",
          icon: "\uDB80\uDF0C",
          label: "high",
          title: "high",
          action: "dell-xps-touchpad-haptics set high",
          provider: "",
          when: "omarchy-hw-dell-xps-haptic-touchpad && omarchy-cmd-present dell-xps-touchpad-haptics",
          checked: '[[ "$(dell-xps-touchpad-haptics get)" == "high" ]]',
          disabled: "",
          children: []
        }]
      }, {
        id: "trigger.hardware.touchscreen-on",
        icon: "\uDB80\uDDBD",
        label: "Enable Touchscreen",
        title: "Enable Touchscreen",
        action: "omarchy-toggle-touchscreen",
        provider: "",
        when: "omarchy-hw-touchscreen && [[ -f ~/.local/state/omarchy/toggles/hypr/touchscreen-disabled-name ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.hardware.touchscreen-off",
        icon: "\uDB80\uDDBD",
        label: "Disable Touchscreen",
        title: "Disable Touchscreen",
        action: "omarchy-toggle-touchscreen",
        provider: "",
        when: "omarchy-hw-touchscreen && [[ ! -f ~/.local/state/omarchy/toggles/hypr/touchscreen-disabled-name ]]",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "trigger.tests",
      icon: "\uDB81\uDCC5",
      label: "Speed Test",
      title: "Speed Test",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "trigger.tests.network-speedtest",
        icon: "\uDB81\uDCC5",
        label: "Network Speed Test",
        title: "Network Speed Test",
        action: "omarchy-shell shell summon omarchy.speedtest",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "trigger.tests.disk-speedtest",
        icon: "\uDB80\uDECA",
        label: "Disk Speed Test",
        title: "Disk Speed Test",
        action: "omarchy-shell shell summon omarchy.disk-speedtest",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }]
  }, {
    id: "setup",
    icon: "",
    label: "Setup",
    title: "Setup",
    action: "",
    provider: "",
    when: "",
    checked: "",
    disabled: "",
    children: [{
      id: "setup.monitors",
      icon: "\uDB80\uDF79",
      label: "Monitors",
      title: "Monitors",
      action: 'omarchy-launch-config-editor "$HOME/.config/hypr/monitors.lua"',
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "setup.keybindings",
      icon: "",
      label: "Keybindings",
      title: "Keybindings",
      action: 'omarchy-launch-config-editor "$HOME/.config/hypr/bindings.lua"',
      provider: "",
      when: "[[ -f ~/.config/hypr/bindings.lua ]]",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "setup.input",
      icon: "",
      label: "Input",
      title: "Input",
      action: 'omarchy-launch-config-editor "$HOME/.config/hypr/input.lua"',
      provider: "",
      when: "[[ -f ~/.config/hypr/input.lua ]]",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "setup.typing",
      icon: "",
      label: "Typing",
      title: "Typing",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "setup.typing.keyboard",
        icon: "",
        label: "Keyboard Layouts",
        title: "Keyboard Layouts",
        action: "omarchy-setup-keyboard",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.typing.input",
        icon: "",
        label: "Input Methods",
        title: "Input Methods",
        action: "omarchy-setup-input",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "setup.language",
      icon: "",
      label: "Language",
      title: "Language",
      action: "",
      provider: "languages",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "setup.network",
      icon: "\uDB81\uDEF3",
      label: "Network",
      title: "Network",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "setup.network.dns",
        icon: "\uDB80\uDDD6",
        label: "DNS",
        title: "DNS",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "setup.network.dns.dhcp",
          icon: "\uDB82\uDE5F",
          label: "DHCP",
          title: "DHCP",
          action: "omarchy-dns DHCP",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-dns)" == "DHCP" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.network.dns.cloudflare",
          icon: "\uDB80\uDD5F",
          label: "Cloudflare",
          title: "Cloudflare",
          action: "omarchy-dns Cloudflare",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-dns)" == "Cloudflare" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.network.dns.google",
          icon: "\uDB80\uDEAD",
          label: "Google",
          title: "Google",
          action: "omarchy-dns Google",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-dns)" == "Google" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.network.dns.custom",
          icon: "",
          label: "Custom",
          title: "Custom",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-dns Custom'",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-dns)" == "Custom" ]]',
          disabled: "",
          children: []
        }]
      }, {
        id: "setup.network.qr",
        icon: "\uDB81\uDC32",
        label: "QR Code",
        title: "QR Code",
        action: "omarchy-shell shell summon omarchy.wifiqr",
        provider: "",
        when: "omarchy-network-wifi-connected",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "setup.default",
      icon: "",
      label: "Defaults",
      title: "Defaults",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "setup.default.agent",
        icon: "\uDB81\uDEA9",
        label: "Agent",
        title: "Default Agent",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "setup.default.agent.amp",
          icon: "",
          label: "Amp",
          title: "Amp",
          action: "omarchy-default-agent amp",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "amp" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.agy",
          icon: "",
          label: "Antigravity",
          title: "Antigravity",
          action: "omarchy-default-agent agy",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "agy" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.claude",
          icon: "",
          label: "Claude",
          title: "Claude",
          action: "omarchy-default-agent claude",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "claude" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.codex",
          icon: "",
          label: "Codex",
          title: "Codex",
          action: "omarchy-default-agent codex",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "codex" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.commandcode",
          icon: "",
          label: "Command Code",
          title: "Command Code",
          action: "omarchy-default-agent commandcode",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "commandcode" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.copilot",
          icon: "",
          label: "Copilot",
          title: "Copilot",
          action: "omarchy-default-agent copilot",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "copilot" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.crush",
          icon: "",
          label: "Crush",
          title: "Crush",
          action: "omarchy-default-agent crush",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "crush" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.cursor-agent",
          icon: "",
          label: "Cursor CLI",
          title: "Cursor CLI",
          action: "omarchy-default-agent cursor-agent",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "cursor-agent" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.dsh",
          icon: "",
          label: "DeepSeek Harness",
          title: "DeepSeek Harness",
          action: "omarchy-default-agent dsh",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "dsh" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.devin",
          icon: "",
          label: "Devin CLI",
          title: "Devin CLI",
          action: "omarchy-default-agent devin",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "devin" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.freebuff",
          icon: "",
          label: "Freebuff",
          title: "Freebuff",
          action: "omarchy-default-agent freebuff",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "freebuff" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.grok",
          icon: "",
          label: "Grok",
          title: "Grok",
          action: "omarchy-default-agent grok",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "grok" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.hermes",
          icon: "",
          label: "Hermes",
          title: "Hermes",
          action: "omarchy-default-agent hermes",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "hermes" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.kilo",
          icon: "",
          label: "Kilo",
          title: "Kilo",
          action: "omarchy-default-agent kilo",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "kilo" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.kimi",
          icon: "",
          label: "Kimi",
          title: "Kimi",
          action: "omarchy-default-agent kimi",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "kimi" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.kiro-cli",
          icon: "",
          label: "Kiro CLI",
          title: "Kiro CLI",
          action: "omarchy-default-agent kiro-cli",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "kiro-cli" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.mcode",
          icon: "",
          label: "MiniMax Code",
          title: "MiniMax Code",
          action: "omarchy-default-agent mcode",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "mcode" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.muse",
          icon: "",
          label: "Muse Code",
          title: "Muse Code",
          action: "omarchy-default-agent muse",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "muse" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.omp",
          icon: "",
          label: "omp",
          title: "omp",
          action: "omarchy-default-agent omp",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "omp" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.openclaw",
          icon: "",
          label: "OpenClaw",
          title: "OpenClaw",
          action: "omarchy-default-agent openclaw",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "openclaw" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.opencode",
          icon: "",
          label: "OpenCode",
          title: "OpenCode",
          action: "omarchy-default-agent opencode",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "opencode" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.ori",
          icon: "",
          label: "Ori",
          title: "Ori",
          action: "omarchy-default-agent ori",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "ori" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.pi",
          icon: "",
          label: "Pi",
          title: "Pi",
          action: "omarchy-default-agent pi",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "pi" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.agent.qwen",
          icon: "",
          label: "Qwen Code",
          title: "Qwen Code",
          action: "omarchy-default-agent qwen",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-agent)" == "qwen" ]]',
          disabled: "",
          children: []
        }]
      }, {
        id: "setup.default.browser",
        icon: "",
        label: "Browser",
        title: "Default Browser",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "setup.default.browser.chromium",
          icon: "",
          label: "Chromium",
          title: "Chromium",
          action: "omarchy-default-browser chromium",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-browser)" == "chromium" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.browser.chrome",
          icon: "\uDB80\uDEAF",
          label: "Chrome",
          title: "Chrome",
          action: "omarchy-default-browser chrome",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-browser)" == "chrome" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.browser.brave",
          icon: "\uDB81\uDD9F",
          label: "Brave",
          title: "Brave",
          action: "omarchy-default-browser brave",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-browser)" == "brave" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.browser.brave-origin",
          icon: "\uDB81\uDD9F",
          label: "Brave Origin",
          title: "Brave Origin",
          action: "omarchy-default-browser brave-origin",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-browser)" == "brave-origin" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.browser.edge",
          icon: "\uDB80\uDDE9",
          label: "Edge",
          title: "Edge",
          action: "omarchy-default-browser edge",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-browser)" == "edge" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.browser.firefox",
          icon: "",
          label: "Firefox",
          title: "Firefox",
          action: "omarchy-default-browser firefox",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-browser)" == "firefox" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.browser.zen",
          icon: "\uDB81\uDD9F",
          label: "Zen",
          title: "Zen",
          action: "omarchy-default-browser zen",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-browser)" == "zen" ]]',
          disabled: "",
          children: []
        }]
      }, {
        id: "setup.default.dictation",
        icon: "",
        label: "Dictation",
        title: "Default Dictation",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "setup.default.dictation.superwhisper",
          icon: "",
          label: "Superwhisper",
          title: "Superwhisper",
          action: "omarchy-default-dictation superwhisper",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-dictation)" == "superwhisper" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.dictation.voxtype",
          icon: "",
          label: "Voxtype",
          title: "Voxtype",
          action: "omarchy-default-dictation voxtype",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-dictation)" == "voxtype" ]]',
          disabled: "",
          children: []
        }]
      }, {
        id: "setup.default.terminal",
        icon: "",
        label: "Terminal",
        title: "Default Terminal",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "setup.default.terminal.alacritty",
          icon: "",
          label: "Alacritty",
          title: "Alacritty",
          action: "omarchy-default-terminal alacritty",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-terminal)" == "alacritty" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.terminal.foot",
          icon: "",
          label: "Foot",
          title: "Foot",
          action: "omarchy-default-terminal foot",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-terminal)" == "foot" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.terminal.ghostty",
          icon: "",
          label: "Ghostty",
          title: "Ghostty",
          action: "omarchy-default-terminal ghostty",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-terminal)" == "ghostty" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.terminal.kitty",
          icon: "",
          label: "Kitty",
          title: "Kitty",
          action: "omarchy-default-terminal kitty",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-terminal)" == "kitty" ]]',
          disabled: "",
          children: []
        }]
      }, {
        id: "setup.default.editor",
        icon: "",
        label: "Editor",
        title: "Default Editor",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "setup.default.editor.neovim",
          icon: "",
          label: "Neovim",
          title: "Neovim",
          action: "omarchy-default-editor nvim",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-editor)" == "nvim" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.editor.vscode",
          icon: "",
          label: "VSCode",
          title: "VSCode",
          action: "omarchy-default-editor code",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-editor)" == "code" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.editor.cursor",
          icon: "",
          label: "Cursor",
          title: "Cursor",
          action: "omarchy-default-editor cursor",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-editor)" == "cursor" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.editor.zed",
          icon: "",
          label: "Zed",
          title: "Zed",
          action: "omarchy-default-editor zed",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-editor)" == "zeditor" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.editor.sublime",
          icon: "",
          label: "Sublime Text",
          title: "Sublime Text",
          action: "omarchy-default-editor sublime_text",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-editor)" == "subl" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.editor.helix",
          icon: "",
          label: "Helix",
          title: "Helix",
          action: "omarchy-default-editor helix",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-editor)" == "helix" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.editor.vim",
          icon: "",
          label: "Vim",
          title: "Vim",
          action: "omarchy-default-editor vim",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-editor)" == "vim" ]]',
          disabled: "",
          children: []
        }, {
          id: "setup.default.editor.emacs",
          icon: " ",
          label: "Emacs",
          title: "Emacs",
          action: "omarchy-default-editor emacs",
          provider: "",
          when: "",
          checked: '[[ "$(omarchy-default-editor)" == "emacs" ]]',
          disabled: "",
          children: []
        }]
      }]
    }, {
      id: "setup.plugin",
      icon: "\uDB81\uDC31",
      label: "Plugins",
      title: "Plugins",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "setup.plugin.enable",
        icon: "\uDB80\uDD2C",
        label: "Enable Plugin",
        title: "Enable Plugin",
        action: "omarchy-menu-plugin enable",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.plugin.disable",
        icon: "\uDB80\uDD56",
        label: "Disable Plugin",
        title: "Disable Plugin",
        action: "omarchy-menu-plugin disable",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.plugin.add",
        icon: "\uDB81\uDD9F",
        label: "Add Plugin",
        title: "Add Plugin",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-plugin-add'",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.plugin.clone",
        icon: "\uDB80\uDD8F",
        label: "Clone Plugin",
        title: "Clone Plugin",
        action: "omarchy-menu-plugin clone",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.plugin.remove",
        icon: "\uDB82\uDF4C",
        label: "Remove Plugin",
        title: "Remove Plugin",
        action: "omarchy-menu-plugin remove",
        provider: "",
        when: 'compgen -G "$HOME/.config/omarchy/plugins/*/manifest.json"',
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "setup.security",
      icon: "",
      label: "Security",
      title: "Security",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "setup.security.fingerprint",
        icon: "\uDB80\uDE37",
        label: "Fingerprint",
        title: "Fingerprint",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-setup-security-fingerprint",
        provider: "",
        when: "omarchy-hw-fingerprint",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.security.fido2",
        icon: "",
        label: "Fido2",
        title: "Fido2",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-setup-security-fido2",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.security.sshd",
        icon: "\uDB82\uDCC0",
        label: "SSHD",
        title: "SSHD",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-setup-security-sshd",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.security.ssh-agent",
        icon: "\uDB82\uDCC0",
        label: "SSH Agent",
        title: "SSH Agent",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-setup-security-ssh-agent",
        provider: "",
        when: "! systemctl --user -q is-enabled gcr-ssh-agent.socket",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.security.sudoless-docker",
        icon: "\uDB82\uDC68",
        label: "Sudoless Docker",
        title: "Sudoless Docker",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-setup-security-sudoless-docker",
        provider: "",
        when: "omarchy-sudo-docker --configured",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.security.passwordless-sudo",
        icon: "\uDB81\uDFF5",
        label: "Passwordless Sudo",
        title: "Passwordless Sudo",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-sudo-passwordless",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "setup.config",
      icon: "",
      label: "Config",
      title: "Config",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "setup.config.git",
        icon: "",
        label: "Git",
        title: "Git",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-setup-git",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.config.hyprland",
        icon: "",
        label: "Hyprland",
        title: "Hyprland",
        action: 'omarchy-launch-config-editor "$HOME/.config/hypr/hyprland.lua"',
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.config.hyprsunset",
        icon: "",
        label: "Hyprsunset",
        title: "Hyprsunset",
        action: "omarchy-launch-config-editor ~/.config/hypr/hyprsunset.conf && omarchy-restart-hyprsunset",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "setup.config.xcompose",
        icon: "\uDB81\uDF85",
        label: "XCompose",
        title: "XCompose",
        action: "omarchy-launch-config-editor ~/.XCompose && omarchy-restart-xcompose",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "setup.direct-boot",
      icon: "",
      label: "Direct Boot",
      title: "Direct Boot",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-setup-direct-boot",
      provider: "",
      when: "! omarchy-hw-aarch64-apple && [[ ! -f /etc/limine-entry-tool.d/zz-omarchy-dgx-spark.conf ]]",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "setup.reset",
      icon: "\uDB81\uDC53",
      label: "Reset Computer",
      title: "Reset Computer",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-system-factory-reset",
      provider: "",
      when: "[[ $(findmnt -no FSTYPE /) == btrfs ]]",
      checked: "",
      disabled: "",
      children: []
    }]
  }, {
    id: "install",
    icon: "\uDB80\uDE49",
    label: "Install",
    title: "Install",
    action: "",
    provider: "",
    when: "",
    checked: "",
    disabled: "",
    children: [{
      id: "install.package",
      icon: "\uDB82\uDCC7",
      label: "Package",
      title: "Package",
      action: "xdg-terminal-exec --app-id=org.omarchy.terminal omarchy-pkg-install",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "install.ai",
      icon: "\uDB85\uDEA4",
      label: "AI",
      title: "AI",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "install.ai.chatgpt",
        icon: "",
        label: "ChatGPT Desktop",
        title: "ChatGPT Desktop",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-ai-chatgpt",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present openai-codex-desktop",
        children: []
      }, {
        id: "install.ai.claude",
        icon: "",
        label: "Claude Desktop",
        title: "Claude Desktop",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-ai-claude",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present claude-desktop",
        children: []
      }, {
        id: "install.ai.grok-bot",
        icon: "",
        label: "Grok Bot",
        title: "Grok Bot",
        action: "omarchy-install-and-launch 'Grok Bot' grok-bot grok-bot",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present grok-bot",
        children: []
      }, {
        id: "install.ai.hermes",
        icon: "",
        label: "Hermes Desktop",
        title: "Hermes Desktop",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-ai-hermes",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present hermes-desktop",
        children: []
      }, {
        id: "install.ai.lm-studio",
        icon: "",
        label: "LM Studio",
        title: "LM Studio",
        action: "omarchy-install-app 'LM Studio' lmstudio-bin",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present lmstudio-bin",
        children: []
      }, {
        id: "install.ai.ollama",
        icon: "",
        label: "Ollama",
        title: "Ollama",
        action: 'if omarchy-cmd-present nvidia-smi; then ollama_pkg=ollama-cuda; elif omarchy-cmd-present rocminfo; then ollama_pkg=ollama-rocm; else ollama_pkg=ollama; fi; omarchy-install-app Ollama "$ollama_pkg"',
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-cmd-present ollama",
        children: []
      }, {
        id: "install.ai.openclaw",
        icon: "",
        label: "OpenClaw",
        title: "OpenClaw",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-ai-openclaw",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present openclaw",
        children: []
      }, {
        id: "install.ai.perplexity",
        icon: "",
        label: "Perplexity",
        title: "Perplexity",
        action: "omarchy-install-and-launch Perplexity perplexity perplexity",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present perplexity",
        children: []
      }, {
        id: "install.ai.t3-code",
        icon: "",
        label: "T3 Code",
        title: "T3 Code",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-ai-t3-code",
        provider: "",
        when: "",
        checked: "",
        disabled: '[[ -f "$HOME/.local/share/t3code/T3-Code.AppImage" ]]',
        children: []
      }]
    }, {
      id: "install.service",
      icon: "",
      label: "Service",
      title: "Service",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "install.service.1password",
        icon: "\uDB82\uDC81",
        label: "1Password",
        title: "1Password",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-service-1password",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present 1password",
        children: []
      }, {
        id: "install.service.dropbox",
        icon: "",
        label: "Dropbox",
        title: "Dropbox",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-service-dropbox",
        provider: "",
        when: "[[ $(getconf PAGESIZE) == 4096 ]]",
        checked: "",
        disabled: "omarchy-pkg-present dropbox",
        children: []
      }, {
        id: "install.service.spotify",
        icon: "\uDB81\uDCC7",
        label: "Spotify",
        title: "Spotify",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-service-spotify",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present spotify || [[ -f $HOME/.local/share/applications/Spotify.desktop ]]",
        children: []
      }, {
        id: "install.service.signal",
        icon: "\uDB82\uDF79",
        label: "Signal",
        title: "Signal",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-service-signal",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present signal-desktop",
        children: []
      }, {
        id: "install.service.slack",
        icon: "\uDB81\uDCB1",
        label: "Slack",
        title: "Slack",
        action: "omarchy-install-and-launch Slack slack-desktop slack",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present slack-desktop",
        children: []
      }, {
        id: "install.service.tailscale",
        icon: "",
        label: "Tailscale",
        title: "Tailscale",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-service-tailscale",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present tailscale",
        children: []
      }, {
        id: "install.service.nordvpn",
        icon: "\uDB84\uDDF1",
        label: "NordVPN",
        title: "NordVPN",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-service-nordvpn",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present nordvpn-bin",
        children: []
      }, {
        id: "install.service.once",
        icon: "\uDB80\uDFD6",
        label: "ONCE",
        title: "ONCE",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-service-once",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present once-bin",
        children: []
      }, {
        id: "install.service.bitwarden",
        icon: "\uDB81\uDFF5",
        label: "Bitwarden",
        title: "Bitwarden",
        action: "omarchy-install-and-launch Bitwarden 'bitwarden bitwarden-cli' bitwarden",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present bitwarden",
        children: []
      }, {
        id: "install.service.microsoft",
        icon: "\uDB80\uDF72",
        label: "Microsoft",
        title: "Microsoft",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-service-microsoft",
        provider: "",
        when: "",
        checked: "",
        disabled: '[[ -f "$HOME/.local/share/applications/Microsoft Outlook.desktop" && -f "$HOME/.local/share/applications/Microsoft Word.desktop" && -f "$HOME/.local/share/applications/Microsoft Excel.desktop" && -f "$HOME/.local/share/applications/Microsoft PowerPoint.desktop" && -f "$HOME/.local/share/applications/Microsoft Teams.desktop" && -f "$HOME/.local/share/applications/Microsoft OneDrive.desktop" ]]',
        children: []
      }, {
        id: "install.service.chromium-account",
        icon: "",
        label: "Chromium Account",
        title: "Chromium Account",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-chromium-google-account",
        provider: "",
        when: "[[ -f ~/.config/chromium-flags.conf ]]",
        checked: "",
        disabled: "grep -q oauth2-client-id ~/.config/chromium-flags.conf",
        children: []
      }]
    }, {
      id: "install.development",
      icon: "\uDB83\uDD6E",
      label: "Development",
      title: "Development",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "install.development.rails",
        icon: "\uDB82\uDECF",
        label: "Ruby on Rails",
        title: "Ruby on Rails",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env ruby'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.local/share/mise/installs/ruby ]]",
        children: []
      }, {
        id: "install.development.docker-dbs",
        icon: "",
        label: "Docker DB",
        title: "Docker DB",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-docker-dbs",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "install.development.javascript",
        icon: "",
        label: "JavaScript",
        title: "JavaScript",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "install.development.javascript.node",
          icon: "",
          label: "Node.js",
          title: "Node.js",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env node'",
          provider: "",
          when: "",
          checked: "",
          disabled: "[[ -d $HOME/.local/share/mise/installs/node ]]",
          children: []
        }, {
          id: "install.development.javascript.bun",
          icon: "",
          label: "Bun",
          title: "Bun",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env bun'",
          provider: "",
          when: "",
          checked: "",
          disabled: "[[ -d $HOME/.local/share/mise/installs/bun ]]",
          children: []
        }, {
          id: "install.development.javascript.deno",
          icon: "",
          label: "Deno",
          title: "Deno",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env deno'",
          provider: "",
          when: "",
          checked: "",
          disabled: "[[ -d $HOME/.local/share/mise/installs/deno ]]",
          children: []
        }]
      }, {
        id: "install.development.go",
        icon: "",
        label: "Go",
        title: "Go",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env go'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.local/share/mise/installs/go ]]",
        children: []
      }, {
        id: "install.development.php",
        icon: "",
        label: "PHP",
        title: "PHP",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "install.development.php.php",
          icon: "",
          label: "PHP",
          title: "PHP",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env php'",
          provider: "",
          when: "",
          checked: "",
          disabled: "[[ -d $HOME/.local/share/mise/installs/php ]]",
          children: []
        }, {
          id: "install.development.php.laravel",
          icon: "",
          label: "Laravel",
          title: "Laravel",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env laravel'",
          provider: "",
          when: "",
          checked: "",
          disabled: "[[ -x $HOME/.local/bin/laravel ]]",
          children: []
        }, {
          id: "install.development.php.symfony",
          icon: "",
          label: "Symfony",
          title: "Symfony",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env symfony'",
          provider: "",
          when: "",
          checked: "",
          disabled: "omarchy-pkg-present symfony-cli",
          children: []
        }]
      }, {
        id: "install.development.python",
        icon: "",
        label: "Python",
        title: "Python",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env python'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.local/share/mise/installs/python ]]",
        children: []
      }, {
        id: "install.development.elixir",
        icon: "",
        label: "Elixir",
        title: "Elixir",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "install.development.elixir.elixir",
          icon: "",
          label: "Elixir",
          title: "Elixir",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env elixir'",
          provider: "",
          when: "",
          checked: "",
          disabled: "[[ -d $HOME/.local/share/mise/installs/elixir ]]",
          children: []
        }, {
          id: "install.development.elixir.phoenix",
          icon: "",
          label: "Phoenix",
          title: "Phoenix",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env phoenix'",
          provider: "",
          when: "",
          checked: "",
          disabled: 'compgen -G "$HOME/.mix/archives/phx_new*"',
          children: []
        }]
      }, {
        id: "install.development.zig",
        icon: "",
        label: "Zig",
        title: "Zig",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env zig'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.local/share/mise/installs/zig ]]",
        children: []
      }, {
        id: "install.development.rust",
        icon: "",
        label: "Rust",
        title: "Rust",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env rust'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.rustup ]]",
        children: []
      }, {
        id: "install.development.java",
        icon: "",
        label: "Java",
        title: "Java",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env java'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.local/share/mise/installs/java ]]",
        children: []
      }, {
        id: "install.development.dotnet",
        icon: "",
        label: ".NET",
        title: ".NET",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env dotnet'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.local/share/mise/installs/dotnet ]]",
        children: []
      }, {
        id: "install.development.ocaml",
        icon: "",
        label: "OCaml",
        title: "OCaml",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env ocaml'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.opam ]]",
        children: []
      }, {
        id: "install.development.clojure",
        icon: "",
        label: "Clojure",
        title: "Clojure",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env clojure'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.local/share/mise/installs/clojure ]]",
        children: []
      }, {
        id: "install.development.scala",
        icon: "",
        label: "Scala",
        title: "Scala",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-dev-env scala'",
        provider: "",
        when: "",
        checked: "",
        disabled: "[[ -d $HOME/.local/share/mise/installs/scala ]]",
        children: []
      }]
    }, {
      id: "install.editor",
      icon: "",
      label: "Editor",
      title: "Editor",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "install.editor.vscode",
        icon: "",
        label: "VSCode",
        title: "VSCode",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-editor-vscode",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present visual-studio-code-bin",
        children: []
      }, {
        id: "install.editor.cursor",
        icon: "",
        label: "Cursor",
        title: "Cursor",
        action: "omarchy-install-and-launch Cursor cursor-bin cursor",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present cursor-bin",
        children: []
      }, {
        id: "install.editor.zed",
        icon: "",
        label: "Zed",
        title: "Zed",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-editor-zed",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present zed",
        children: []
      }, {
        id: "install.editor.sublime",
        icon: "",
        label: "Sublime Text",
        title: "Sublime Text",
        action: "omarchy-install-and-launch 'Sublime Text' sublime-text-4 sublime_text",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present sublime-text-4",
        children: []
      }, {
        id: "install.editor.helix",
        icon: "",
        label: "Helix",
        title: "Helix",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-editor-helix",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present helix",
        children: []
      }, {
        id: "install.editor.vim",
        icon: "",
        label: "Vim",
        title: "Vim",
        action: "omarchy-install-app Vim vim",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present vim",
        children: []
      }, {
        id: "install.editor.emacs",
        icon: "",
        label: "Emacs",
        title: "Emacs",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-editor-emacs",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present omarchy-emacs",
        children: []
      }]
    }, {
      id: "install.style",
      icon: "",
      label: "Style",
      title: "Style",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "install.style.theme",
        icon: "\uDB83\uDE0C",
        label: "Theme",
        title: "Theme",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-theme-install",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "install.style.background",
        icon: "",
        label: "Background",
        title: "Background",
        action: "omarchy-theme-bg-install",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "install.style.font",
        icon: "",
        label: "Font",
        title: "Font",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "install.style.font.cascadia",
          icon: "",
          label: "Cascadia Mono",
          title: "Cascadia Mono",
          action: "omarchy-install-font 'Cascadia Mono' ttf-cascadia-mono-nerd 'CaskaydiaMono Nerd Font'",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "install.style.font.meslo",
          icon: "",
          label: "Meslo LG Mono",
          title: "Meslo LG Mono",
          action: "omarchy-install-font 'Meslo LG Mono' ttf-meslo-nerd 'MesloLGL Nerd Font'",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "install.style.font.fira",
          icon: "",
          label: "Fira Code",
          title: "Fira Code",
          action: "omarchy-install-font 'Fira Code' ttf-firacode-nerd 'FiraCode Nerd Font'",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "install.style.font.victor",
          icon: "",
          label: "Victor Code",
          title: "Victor Code",
          action: "omarchy-install-font 'Victor Code' ttf-victor-mono-nerd 'VictorMono Nerd Font'",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "install.style.font.bitstream",
          icon: "",
          label: "Bitstream Vera Mono",
          title: "Bitstream Vera Mono",
          action: "omarchy-install-font 'Bitstream Vera Code' ttf-bitstream-vera-mono-nerd 'BitstromWera Nerd Font'",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "install.style.font.iosevka",
          icon: "",
          label: "Iosevka",
          title: "Iosevka",
          action: "omarchy-install-font Iosevka ttf-iosevka-nerd 'Iosevka Nerd Font Mono'",
          provider: "",
          when: "",
          checked: "",
          disabled: "",
          children: []
        }]
      }]
    }, {
      id: "install.gaming",
      icon: "",
      label: "Gaming",
      title: "Gaming",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "install.gaming.steam",
        icon: "",
        label: "Steam",
        title: "Steam",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-gaming-steam",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present steam",
        children: []
      }, {
        id: "install.gaming.retroarch",
        icon: "\uDB82\uDFC9",
        label: "RetroArch",
        title: "RetroArch",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-gaming-retroarch",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present retroarch",
        children: []
      }, {
        id: "install.gaming.minecraft",
        icon: "\uDB80\uDF73",
        label: "Minecraft",
        title: "Minecraft",
        action: "omarchy-install-and-launch Minecraft minecraft-launcher minecraft-launcher",
        provider: "",
        when: "omarchy-hw-x86",
        checked: "",
        disabled: "omarchy-pkg-present minecraft-launcher",
        children: []
      }, {
        id: "install.gaming.geforce-now",
        icon: "\uDB82\uDCB9",
        label: "NVIDIA GeForce NOW",
        title: "NVIDIA GeForce NOW",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-gaming-geforce-now",
        provider: "",
        when: "omarchy-hw-x86",
        checked: "",
        disabled: "flatpak info com.nvidia.geforcenow",
        children: []
      }, {
        id: "install.gaming.xbox-cloud",
        icon: "",
        label: "Xbox Cloud Gaming",
        title: "Xbox Cloud Gaming",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-gaming-xbox-cloud",
        provider: "",
        when: "",
        checked: "",
        disabled: '[[ -f "$HOME/.local/share/applications/Xbox Cloud Gaming.desktop" ]]',
        children: []
      }, {
        id: "install.gaming.xbox-controllers",
        icon: "\uDB80\uDCAF",
        label: "Xbox Controllers",
        title: "Xbox Controllers",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-gaming-xbox-controllers",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present xpadneo-dkms",
        children: []
      }, {
        id: "install.gaming.battlenet",
        icon: "",
        label: "Battle.net",
        title: "Battle.net",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-gaming-battlenet",
        provider: "",
        when: "omarchy-hw-x86",
        checked: "",
        disabled: "[[ -d $HOME/Games/battlenet ]]",
        children: []
      }, {
        id: "install.gaming.lutris",
        icon: "",
        label: "Lutris",
        title: "Lutris",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-gaming-lutris",
        provider: "",
        when: "omarchy-hw-x86",
        checked: "",
        disabled: "omarchy-pkg-present lutris",
        children: []
      }, {
        id: "install.gaming.heroic",
        icon: "\uDB85\uDCDF",
        label: "Heroic (Epic Games)",
        title: "Heroic (Epic Games)",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-gaming-heroic",
        provider: "",
        when: "omarchy-hw-x86",
        checked: "",
        disabled: "omarchy-pkg-present heroic-games-launcher-bin",
        children: []
      }, {
        id: "install.gaming.retro-launcher",
        icon: "\uDB82\uDFC9",
        label: "RetroArch Game Launcher",
        title: "RetroArch Game Launcher",
        action: "omarchy-games-retro-install",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "install.browser",
      icon: "",
      label: "Browser",
      title: "Browser",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "install.browser.chrome",
        icon: "",
        label: "Chrome",
        title: "Chrome",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-browser chrome'",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present google-chrome",
        children: []
      }, {
        id: "install.browser.edge",
        icon: "\uDB80\uDDE9",
        label: "Edge",
        title: "Edge",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-browser edge'",
        provider: "",
        when: "omarchy-hw-x86",
        checked: "",
        disabled: "omarchy-pkg-present microsoft-edge-stable-bin",
        children: []
      }, {
        id: "install.browser.brave",
        icon: "",
        label: "Brave",
        title: "Brave",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-browser brave'",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present brave-bin",
        children: []
      }, {
        id: "install.browser.brave-origin",
        icon: "",
        label: "Brave Origin",
        title: "Brave Origin",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-browser brave-origin'",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present brave-origin-bin",
        children: []
      }, {
        id: "install.browser.firefox",
        icon: "",
        label: "Firefox",
        title: "Firefox",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-browser firefox'",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present firefox",
        children: []
      }, {
        id: "install.browser.zen",
        icon: "\uDB81\uDD9F",
        label: "Zen",
        title: "Zen",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-browser zen'",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present zen-browser-bin",
        children: []
      }]
    }, {
      id: "install.webapp",
      icon: "",
      label: "Web App",
      title: "Web App",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-webapp-install",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "install.terminal",
      icon: "",
      label: "Terminal",
      title: "Terminal",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "install.terminal.alacritty",
        icon: "",
        label: "Alacritty",
        title: "Alacritty",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-terminal alacritty'",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present alacritty",
        children: []
      }, {
        id: "install.terminal.foot",
        icon: "",
        label: "Foot",
        title: "Foot",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-terminal foot'",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present foot",
        children: []
      }, {
        id: "install.terminal.ghostty",
        icon: "",
        label: "Ghostty",
        title: "Ghostty",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-terminal ghostty'",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present ghostty",
        children: []
      }, {
        id: "install.terminal.kitty",
        icon: "",
        label: "Kitty",
        title: "Kitty",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-install-terminal kitty'",
        provider: "",
        when: "",
        checked: "",
        disabled: "omarchy-pkg-present kitty",
        children: []
      }]
    }, {
      id: "install.tui",
      icon: "",
      label: "TUI",
      title: "TUI",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-tui-install",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "install.windows",
      icon: "\uDB80\uDF72",
      label: "Windows",
      title: "Windows",
      action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-windows-vm install'",
      provider: "",
      when: "omarchy-hw-x86",
      checked: "",
      disabled: "[[ -f $HOME/.local/share/applications/windows-vm.desktop ]]",
      children: []
    }, {
      id: "install.aur",
      icon: "\uDB82\uDCC7",
      label: "AUR",
      title: "AUR",
      action: "xdg-terminal-exec --app-id=org.omarchy.terminal omarchy-pkg-aur-install",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "install.preinstalls",
      icon: "\uDB80\uDFD3",
      label: "Preinstalls",
      title: "Preinstalls",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-install-preinstalls",
      provider: "",
      when: "",
      checked: "",
      disabled: "[[ ! -f $HOME/.local/state/omarchy/preinstalls-removed ]]",
      children: []
    }]
  }, {
    id: "remove",
    icon: "\uDB82\uDF4C",
    label: "Remove",
    title: "Remove",
    action: "",
    provider: "",
    when: "",
    checked: "",
    disabled: "",
    children: [{
      id: "remove.package",
      icon: "\uDB82\uDCC7",
      label: "Package",
      title: "Package",
      action: "xdg-terminal-exec --app-id=org.omarchy.terminal omarchy-pkg-remove",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "remove.ai",
      icon: "\uDB85\uDEA4",
      label: "AI",
      title: "Remove",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "remove.ai.hermes",
        icon: "",
        label: "Hermes Desktop",
        title: "Hermes Desktop",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-ai-hermes",
        provider: "",
        when: "omarchy-pkg-present hermes-desktop",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.ai.chatgpt",
        icon: "",
        label: "ChatGPT Desktop",
        title: "ChatGPT Desktop",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-ai-chatgpt",
        provider: "",
        when: "omarchy-pkg-present openai-codex-desktop",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.ai.claude",
        icon: "",
        label: "Claude Desktop",
        title: "Claude Desktop",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-ai-claude",
        provider: "",
        when: "omarchy-pkg-present claude-desktop",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.ai.grok-bot",
        icon: "",
        label: "Grok Bot",
        title: "Grok Bot",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-ai-grok-bot",
        provider: "",
        when: "omarchy-pkg-present grok-bot",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.ai.lm-studio",
        icon: "",
        label: "LM Studio",
        title: "LM Studio",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-ai-lm-studio",
        provider: "",
        when: "omarchy-pkg-present lmstudio-bin",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.ai.ollama",
        icon: "",
        label: "Ollama",
        title: "Ollama",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-ai-ollama",
        provider: "",
        when: "omarchy-pkg-present ollama",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.ai.openclaw",
        icon: "",
        label: "OpenClaw",
        title: "OpenClaw",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-ai-openclaw",
        provider: "",
        when: "omarchy-pkg-present openclaw",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.ai.perplexity",
        icon: "",
        label: "Perplexity",
        title: "Perplexity",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-ai-perplexity",
        provider: "",
        when: "omarchy-pkg-present perplexity",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.ai.t3-code",
        icon: "",
        label: "T3 Code",
        title: "T3 Code",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-ai-t3-code",
        provider: "",
        when: '[[ -f "$HOME/.local/share/t3code/T3-Code.AppImage" ]] || omarchy-pkg-present t3code-bin || omarchy-pkg-present t3code-nightly-bin',
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "remove.dictation",
      icon: "",
      label: "Dictation",
      title: "Dictation",
      action: "",
      provider: "",
      when: "omarchy-pkg-present voxtype-bin || omarchy-pkg-present superwhisper-bin",
      checked: "",
      disabled: "",
      children: [{
        id: "remove.dictation.superwhisper",
        icon: "",
        label: "Superwhisper",
        title: "Superwhisper",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-dictation-superwhisper",
        provider: "",
        when: "omarchy-pkg-present superwhisper-bin",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.dictation.voxtype",
        icon: "",
        label: "Voxtype",
        title: "Voxtype",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-dictation-voxtype",
        provider: "",
        when: "omarchy-pkg-present voxtype-bin",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "remove.service",
      icon: "",
      label: "Services",
      title: "Remove",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "remove.service.1password",
        icon: "\uDB82\uDC81",
        label: "1Password",
        title: "1Password",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-service-1password",
        provider: "",
        when: "omarchy-pkg-present 1password",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.service.dropbox",
        icon: "",
        label: "Dropbox",
        title: "Dropbox",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-service-dropbox",
        provider: "",
        when: "omarchy-pkg-present dropbox",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.service.tailscale",
        icon: "",
        label: "Tailscale",
        title: "Tailscale",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-service-tailscale",
        provider: "",
        when: "omarchy-pkg-present tailscale",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.service.microsoft",
        icon: "\uDB80\uDF72",
        label: "Microsoft",
        title: "Microsoft",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-service-microsoft",
        provider: "",
        when: '[[ -f "$HOME/.local/share/applications/Microsoft Outlook.desktop" || -f "$HOME/.local/share/applications/Microsoft Word.desktop" || -f "$HOME/.local/share/applications/Microsoft Excel.desktop" || -f "$HOME/.local/share/applications/Microsoft PowerPoint.desktop" || -f "$HOME/.local/share/applications/Microsoft Teams.desktop" || -f "$HOME/.local/share/applications/Microsoft OneDrive.desktop" ]]',
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.service.ssh-agent",
        icon: "\uDB82\uDCC0",
        label: "SSH Agent",
        title: "SSH Agent",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-service-ssh-agent",
        provider: "",
        when: "systemctl --user -q is-enabled gcr-ssh-agent.socket",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "remove.development",
      icon: "\uDB83\uDD6E",
      label: "Development",
      title: "Remove",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "remove.development.rails",
        icon: "\uDB82\uDECF",
        label: "Ruby on Rails",
        title: "Ruby on Rails",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env ruby'",
        provider: "",
        when: "[[ -d $HOME/.local/share/mise/installs/ruby ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.development.javascript",
        icon: "",
        label: "JavaScript",
        title: "Remove",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "remove.development.javascript.node",
          icon: "",
          label: "Node.js",
          title: "Node.js",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env node'",
          provider: "",
          when: "[[ -d $HOME/.local/share/mise/installs/node ]]",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "remove.development.javascript.bun",
          icon: "",
          label: "Bun",
          title: "Bun",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env bun'",
          provider: "",
          when: "[[ -d $HOME/.local/share/mise/installs/bun ]]",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "remove.development.javascript.deno",
          icon: "",
          label: "Deno",
          title: "Deno",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env deno'",
          provider: "",
          when: "[[ -d $HOME/.local/share/mise/installs/deno ]]",
          checked: "",
          disabled: "",
          children: []
        }]
      }, {
        id: "remove.development.go",
        icon: "",
        label: "Go",
        title: "Go",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env go'",
        provider: "",
        when: "[[ -d $HOME/.local/share/mise/installs/go ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.development.php",
        icon: "",
        label: "PHP",
        title: "Remove",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "remove.development.php.php",
          icon: "",
          label: "PHP",
          title: "PHP",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env php'",
          provider: "",
          when: "[[ -d $HOME/.local/share/mise/installs/php ]] || omarchy-pkg-present php",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "remove.development.php.laravel",
          icon: "",
          label: "Laravel",
          title: "Laravel",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env laravel'",
          provider: "",
          when: "[[ -x $HOME/.local/bin/laravel || -x $HOME/.config/composer/vendor/bin/laravel ]]",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "remove.development.php.symfony",
          icon: "",
          label: "Symfony",
          title: "Symfony",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env symfony'",
          provider: "",
          when: "omarchy-pkg-present symfony-cli",
          checked: "",
          disabled: "",
          children: []
        }]
      }, {
        id: "remove.development.python",
        icon: "",
        label: "Python",
        title: "Python",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env python'",
        provider: "",
        when: "[[ -d $HOME/.local/share/mise/installs/python ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.development.elixir",
        icon: "",
        label: "Elixir",
        title: "Remove",
        action: "",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: [{
          id: "remove.development.elixir.elixir",
          icon: "",
          label: "Elixir",
          title: "Elixir",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env elixir'",
          provider: "",
          when: "[[ -d $HOME/.local/share/mise/installs/elixir ]]",
          checked: "",
          disabled: "",
          children: []
        }, {
          id: "remove.development.elixir.phoenix",
          icon: "",
          label: "Phoenix",
          title: "Phoenix",
          action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env phoenix'",
          provider: "",
          when: "[[ -d $HOME/.local/share/mise/installs/elixir ]]",
          checked: "",
          disabled: "",
          children: []
        }]
      }, {
        id: "remove.development.zig",
        icon: "",
        label: "Zig",
        title: "Zig",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env zig'",
        provider: "",
        when: "[[ -d $HOME/.local/share/mise/installs/zig ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.development.rust",
        icon: "",
        label: "Rust",
        title: "Rust",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env rust'",
        provider: "",
        when: "[[ -d $HOME/.rustup ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.development.java",
        icon: "",
        label: "Java",
        title: "Java",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env java'",
        provider: "",
        when: "[[ -d $HOME/.local/share/mise/installs/java ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.development.dotnet",
        icon: "",
        label: ".NET",
        title: ".NET",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env dotnet'",
        provider: "",
        when: "[[ -d $HOME/.local/share/mise/installs/dotnet ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.development.ocaml",
        icon: "",
        label: "OCaml",
        title: "OCaml",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env ocaml'",
        provider: "",
        when: "[[ -d $HOME/.opam ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.development.clojure",
        icon: "",
        label: "Clojure",
        title: "Clojure",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env clojure'",
        provider: "",
        when: "[[ -d $HOME/.local/share/mise/installs/clojure ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.development.scala",
        icon: "",
        label: "Scala",
        title: "Scala",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-dev-env scala'",
        provider: "",
        when: "[[ -d $HOME/.local/share/mise/installs/scala ]]",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "remove.theme",
      icon: "\uDB83\uDE0C",
      label: "Theme",
      title: "Theme",
      action: "omarchy-theme-remove",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "remove.gaming",
      icon: "",
      label: "Gaming",
      title: "Remove",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "remove.gaming.steam",
        icon: "",
        label: "Steam",
        title: "Steam",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-gaming-steam",
        provider: "",
        when: "omarchy-pkg-present steam",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.gaming.retroarch",
        icon: "",
        label: "RetroArch",
        title: "RetroArch",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-gaming-retroarch",
        provider: "",
        when: "omarchy-pkg-present retroarch",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.gaming.minecraft",
        icon: "\uDB80\uDF73",
        label: "Minecraft",
        title: "Minecraft",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-gaming-minecraft",
        provider: "",
        when: "omarchy-pkg-present minecraft-launcher",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.gaming.geforce-now",
        icon: "\uDB82\uDCB9",
        label: "NVIDIA GeForce NOW",
        title: "NVIDIA GeForce NOW",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-gaming-geforce-now",
        provider: "",
        when: "flatpak info com.nvidia.geforcenow",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.gaming.xbox-cloud",
        icon: "",
        label: "Xbox Cloud Gaming",
        title: "Xbox Cloud Gaming",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-gaming-xbox-cloud",
        provider: "",
        when: '[[ -f "$HOME/.local/share/applications/Xbox Cloud Gaming.desktop" ]]',
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.gaming.xbox-controllers",
        icon: "\uDB81\uDDBA",
        label: "Xbox Controllers (\uDB80\uDCAF)",
        title: "Xbox Controllers (\uDB80\uDCAF)",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-gaming-xbox-controllers",
        provider: "",
        when: "omarchy-pkg-present xpadneo-dkms",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.gaming.battlenet",
        icon: "",
        label: "Battle.net",
        title: "Battle.net",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-gaming-battlenet",
        provider: "",
        when: "[[ -d $HOME/Games/battlenet ]]",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.gaming.lutris",
        icon: "",
        label: "Lutris",
        title: "Lutris",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-gaming-lutris",
        provider: "",
        when: "omarchy-pkg-present lutris",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.gaming.heroic",
        icon: "\uDB85\uDCDF",
        label: "Heroic (Epic Games)",
        title: "Heroic (Epic Games)",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-gaming-heroic",
        provider: "",
        when: "omarchy-pkg-present heroic-games-launcher-bin",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "remove.browser",
      icon: "",
      label: "Browser",
      title: "Remove",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "remove.browser.chrome",
        icon: "",
        label: "Chrome",
        title: "Chrome",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-browser chrome'",
        provider: "",
        when: "omarchy-pkg-present google-chrome",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.browser.edge",
        icon: "\uDB80\uDDE9",
        label: "Edge",
        title: "Edge",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-browser edge'",
        provider: "",
        when: "omarchy-pkg-present microsoft-edge-stable-bin",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.browser.brave",
        icon: "",
        label: "Brave",
        title: "Brave",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-browser brave'",
        provider: "",
        when: "omarchy-pkg-present brave-bin",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.browser.brave-origin",
        icon: "",
        label: "Brave Origin",
        title: "Brave Origin",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-browser brave-origin'",
        provider: "",
        when: "omarchy-pkg-present brave-origin-bin",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.browser.firefox",
        icon: "",
        label: "Firefox",
        title: "Firefox",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-browser firefox'",
        provider: "",
        when: "omarchy-pkg-present firefox",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.browser.zen",
        icon: "",
        label: "Zen",
        title: "Zen",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-remove-browser zen'",
        provider: "",
        when: "omarchy-pkg-present zen-browser-bin",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "remove.webapp",
      icon: "",
      label: "Web App",
      title: "Web App",
      action: "omarchy-webapp-remove",
      provider: "",
      when: "grep -qE '^Exec=.*(omarchy-launch-webapp|omarchy-webapp-handler)' $HOME/.local/share/applications/*.desktop",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "remove.tui",
      icon: "",
      label: "TUI",
      title: "TUI",
      action: "omarchy-tui-remove",
      provider: "",
      when: "grep -qE '^Exec=.*(\\$TERMINAL|xdg-terminal-exec).*-e' $HOME/.local/share/applications/*.desktop",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "remove.windows",
      icon: "\uDB80\uDF72",
      label: "Windows",
      title: "Windows",
      action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-windows-vm remove'",
      provider: "",
      when: "[[ -f $HOME/.local/share/applications/windows-vm.desktop ]]",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "remove.preinstalls",
      icon: "\uDB80\uDFD3",
      label: "Preinstalls",
      title: "Preinstalls",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-preinstalls",
      provider: "",
      when: "[[ ! -f $HOME/.local/state/omarchy/preinstalls-removed ]]",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "remove.security",
      icon: "",
      label: "Security",
      title: "Remove",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "remove.security.fingerprint",
        icon: "\uDB80\uDE37",
        label: "Fingerprint",
        title: "Fingerprint",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-security-fingerprint",
        provider: "",
        when: "omarchy-pkg-present fprintd",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.security.fido2",
        icon: "",
        label: "Fido2",
        title: "Fido2",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-security-fido2",
        provider: "",
        when: "omarchy-pkg-present pam-u2f",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.security.sshd",
        icon: "\uDB82\uDCC0",
        label: "SSHD",
        title: "SSHD",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-security-sshd",
        provider: "",
        when: "systemctl is-enabled --quiet sshd",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "remove.security.sudoless-docker",
        icon: "\uDB82\uDC68",
        label: "Sudoless Docker",
        title: "Sudoless Docker",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-remove-security-sudoless-docker",
        provider: "",
        when: "! omarchy-sudo-docker --configured",
        checked: "",
        disabled: "",
        children: []
      }]
    }]
  }, {
    id: "update",
    icon: "",
    label: "Update",
    title: "Update",
    action: "",
    provider: "",
    when: "",
    checked: "",
    disabled: "",
    children: [{
      id: "update.omarchy",
      icon: "",
      label: "Omarchy",
      title: "Omarchy",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-update",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "update.channel",
      icon: "\uDB81\uDD2B",
      label: "Channel",
      title: "Channel",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "update.channel.stable",
        icon: "\uD83D\uDFE2",
        label: "Stable",
        title: "Stable",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-channel-set stable'",
        provider: "",
        when: "",
        checked: '[[ "$(omarchy-channel-current)" == "stable" ]]',
        disabled: "",
        children: []
      }, {
        id: "update.channel.rc",
        icon: "\uD83D\uDFE1",
        label: "RC",
        title: "RC",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-channel-set rc'",
        provider: "",
        when: "",
        checked: '[[ "$(omarchy-channel-current)" == "rc" ]]',
        disabled: "",
        children: []
      }, {
        id: "update.channel.edge",
        icon: "\uD83D\uDFE0",
        label: "Edge",
        title: "Edge",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-channel-set edge'",
        provider: "",
        when: "",
        checked: '[[ "$(omarchy-channel-current)" == "edge" ]]',
        disabled: "",
        children: []
      }, {
        id: "update.channel.dev",
        icon: "\uD83D\uDD34",
        label: "Dev",
        title: "Dev",
        action: "omarchy-launch-floating-terminal-with-presentation 'omarchy-channel-set dev'",
        provider: "",
        when: "",
        checked: '[[ "$(omarchy-channel-current)" == "dev" ]]',
        disabled: "",
        children: []
      }]
    }, {
      id: "update.kernel",
      icon: "",
      label: "Kernel",
      title: "Kernel",
      action: "",
      provider: "kernels",
      when: "(( $(omarchy-kernel list | wc -l) > 1 ))",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "update.config",
      icon: "",
      label: "Config",
      title: "Reset to default",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "update.config.hyprland",
        icon: "",
        label: "Hyprland",
        title: "Hyprland",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-refresh-hyprland",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "update.config.hyprsunset",
        icon: "",
        label: "Hyprsunset",
        title: "Hyprsunset",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-refresh-hyprsunset",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "update.config.plymouth",
        icon: "\uDB86\uDCF4",
        label: "Plymouth",
        title: "Plymouth",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-refresh-plymouth",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "update.config.tmux",
        icon: "",
        label: "Tmux",
        title: "Tmux",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-refresh-tmux",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "update.config.shell",
        icon: "\uDB80\uDF5C",
        label: "Shell",
        title: "Shell",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-refresh-shell",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "update.themes",
      icon: "\uDB83\uDE0C",
      label: "Extra Themes",
      title: "Extra Themes",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-theme-update",
      provider: "",
      when: "omarchy-theme-extras",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "update.process",
      icon: "",
      label: "Process",
      title: "Restart",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "update.process.hyprsunset",
        icon: "",
        label: "Hyprsunset",
        title: "Hyprsunset",
        action: "omarchy-restart-hyprsunset",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "update.process.shell",
        icon: "\uDB80\uDF5C",
        label: "Shell",
        title: "Shell",
        action: "omarchy-restart-shell",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "update.hardware",
      icon: "\uDB80\uDDC5",
      label: "Hardware",
      title: "Restart",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "update.hardware.audio",
        icon: "",
        label: "Audio",
        title: "Audio",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-restart-audio",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "update.hardware.wifi",
        icon: "\uDB85\uDEBE",
        label: "Wi-Fi",
        title: "Wi-Fi",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-restart-wifi",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "update.hardware.bluetooth",
        icon: "\uDB80\uDCAF",
        label: "Bluetooth",
        title: "Bluetooth",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-restart-bluetooth",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "update.hardware.trackpad",
        icon: "\uDB81\uDFF8",
        label: "Trackpad",
        title: "Trackpad",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-restart-trackpad",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "update.firmware",
      icon: "",
      label: "Firmware",
      title: "Firmware",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-update-firmware",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "update.password",
      icon: "",
      label: "Password",
      title: "Password",
      action: "",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [{
        id: "update.password.drive",
        icon: "",
        label: "Drive Encryption",
        title: "Drive Encryption",
        action: "omarchy-launch-floating-terminal-with-presentation omarchy-drive-password",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }, {
        id: "update.password.user",
        icon: "",
        label: "User",
        title: "User",
        action: "omarchy-launch-floating-terminal-with-presentation passwd",
        provider: "",
        when: "",
        checked: "",
        disabled: "",
        children: []
      }]
    }, {
      id: "update.timezone",
      icon: "",
      label: "Timezone",
      title: "Timezone",
      action: "omarchy-menu-timezone",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "update.time",
      icon: "",
      label: "Time",
      title: "Time",
      action: "omarchy-launch-floating-terminal-with-presentation omarchy-update-time",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }]
  }, {
    id: "about",
    icon: "",
    label: "About",
    title: "About",
    action: "omarchy-launch-about",
    provider: "",
    when: "",
    checked: "",
    disabled: "",
    children: []
  }, {
    id: "system",
    icon: "",
    label: "System",
    title: "System",
    action: "",
    provider: "",
    when: "",
    checked: "",
    disabled: "",
    children: [{
      id: "system.screensaver",
      icon: "\uDB84\uDD04",
      label: "Screensaver",
      title: "Screensaver",
      action: "omarchy-launch-screensaver force",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "system.lock",
      icon: "",
      label: "Lock",
      title: "Lock",
      action: "omarchy-system-lock",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "system.suspend",
      icon: "\uDB81\uDCB2",
      label: "Suspend",
      title: "Suspend",
      action: "systemctl suspend",
      provider: "",
      when: "! omarchy-toggle-enabled suspend-off && ! omarchy-sleep-disabled",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "system.hibernate",
      icon: "\uDB82\uDD01",
      label: "Hibernate",
      title: "Hibernate",
      action: "systemctl hibernate",
      provider: "",
      when: "omarchy-hibernation-available && ! omarchy-sleep-disabled",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "system.logout",
      icon: "\uDB80\uDF43",
      label: "Logout",
      title: "Logout",
      action: "omarchy-system logout",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "system.reboot",
      icon: "\uDB81\uDF09",
      label: "Reboot",
      title: "Reboot",
      action: "omarchy-system reboot",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }, {
      id: "system.shutdown",
      icon: "\uDB81\uDC25",
      label: "Shutdown",
      title: "Shutdown",
      action: "omarchy-system shutdown",
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: []
    }]
  }, {
    id: "trigger.capture.screenrecord.stop",
    icon: "",
    label: "Stop Screenrecording",
    title: "Stop Screenrecording",
    action: "omarchy-capture-screenrecording --stop-recording",
    provider: "",
    when: "omarchy-capture-screenrecording --status",
    checked: "",
    disabled: "",
    children: []
  }];

  // shell/src/menu.ts
  var PROVIDERS = {
    fonts: {
      script: `current=$(omarchy-font-current 2>/dev/null); omarchy-font-list 2>/dev/null | while read -r f; do [[ -z $f ]] && continue; printf '%s	%s	%s
' "$f" "$f" "$current"; done`,
      icon: "",
      action: (value) => `omarchy-font-set ${quote(value)}`
    },
    "power-profiles": {
      script: `current=$(powerprofilesctl get 2>/dev/null); omarchy-powerprofiles-list 2>/dev/null | while read -r p; do [[ -z $p ]] && continue; printf '%s	%s	%s
' "$p" "$p" "$current"; done`,
      icon: "\uDB81\uDC0B",
      action: (value) => `omarchy-powerprofiles-set autodetect ${quote(value)}`
    },
    kernels: {
      script: `current=$(omarchy-kernel get 2>/dev/null); omarchy-kernel list 2>/dev/null | while read -r k; do [[ -z $k ]] && continue; printf '%s	%s	%s
' "$k" "$k" "$current"; done`,
      icon: "",
      action: (value) => `omarchy-kernel set ${quote(value)}`
    },
    languages: {
      script: `current=$(omarchy-language 2>/dev/null); omarchy-language list 2>/dev/null | while IFS=$'	' read -r name code english; do [[ -z $code ]] && continue; printf '%s	%s	%s	%s
' "$name" "$code" "$current" "$english"; done`,
      icon: "",
      action: (value) => `omarchy-language ${quote(value)}`
    }
  };
  function quote(s) {
    return `'${s.replace(/'/g, `'\\''`)}'`;
  }
  function row(id, icon, label, action, current = false) {
    return {
      id,
      icon,
      label,
      title: label,
      action,
      provider: "",
      when: "",
      checked: "",
      disabled: "",
      children: [],
      current
    };
  }
  var UNDRAWN_LANGUAGES = new Set(["ar", "fa", "ur", "bn", "he", "hi", "si", "ta", "th"]);
  function providerRows(parent, provider, output) {
    const spec = PROVIDERS[provider];
    const rows = [];
    const taken = new Set;
    for (const line of output.split(`
`)) {
      const [label = "", value = label, current = ""] = line.trim().split("\t");
      if (!label || provider === "languages" && UNDRAWN_LANGUAGES.has(value))
        continue;
      let id = `${parent}.${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      while (taken.has(id))
        id += "-";
      taken.add(id);
      rows.push(row(id, spec.icon, label, spec.action(value), value === current));
    }
    return rows;
  }
  var ROOT_TITLE = "Go";
  function shown(items, truth) {
    return items.filter((item) => !item.when || truth[item.when] === true);
  }
  function conditionsOf(items) {
    const commands = new Set;
    for (const item of items)
      for (const c of [item.when, item.checked, item.disabled])
        if (c)
          commands.add(c);
    return [...commands];
  }
  function pathTo(items, id) {
    for (const item of items) {
      if (item.id === id)
        return [item];
      const below = pathTo(item.children, id);
      if (below)
        return [item, ...below];
    }
    return null;
  }

  // shell/src/system.ts
  var [state, setState] = createSignal(null);
  createRoot(() => createEffect(on(() => state()?.powerProfile ?? null, (profile) => {
    if (profile)
      globalThis.omarchyBridge?.powerProfile?.(profile);
  })));
  var targets = new Map;
  function serve(target, methods) {
    targets.set(target, {
      ...targets.get(target),
      ...methods
    });
  }
  onEvent((event) => {
    if (event.event === "state") {
      setState(event.state);
      return;
    }
    if (event.event === "hello") {
      request({
        method: "state"
      }).then(setState, () => {});
      return;
    }
    if (event.event !== "shell")
      return;
    const method = targets.get(event.target)?.[event.method];
    if (!method)
      return answer(event.call, false);
    let output;
    try {
      output = method(...event.args);
    } catch (error) {
      console.log(`omarchy-shell ${event.target} ${event.method}: ${error}`);
      return answer(event.call, false);
    }
    answer(event.call, true, output ?? "");
  });

  // shell/src/generated/palette.ts
  var PALETTE = {
    accent: "#7aa2f7",
    selection: "#292e42",
    muted: "#414868",
    background: "#1a1b26",
    dark_background: "#13141c",
    darker_background: "#0e0e14",
    lighter_background: "#24283b",
    foreground: "#a9b1d6",
    dark_foreground: "#565f89",
    light_foreground: "#b4bee6",
    bright_foreground: "#c0caf5",
    red: "#f7768e",
    yellow: "#e0af68",
    orange: "#eb927b",
    green: "#9ece6a",
    cyan: "#449dab",
    blue: "#7aa2f7",
    magenta: "#ad8ee6",
    brown: "#75493d",
    bright_red: "#ff7a93",
    bright_yellow: "#ff9e64",
    bright_green: "#b9f27c",
    bright_cyan: "#0db9d7",
    bright_blue: "#7da6ff",
    bright_magenta: "#bb9af7"
  };

  // shell/src/theme.ts
  var [palette, setPalette] = createSignal(PALETTE);
  function color(name, alpha = 1) {
    const hex = palette()[name] ?? PALETTE[name] ?? "#ff00ff";
    if (alpha >= 1)
      return hex;
    const a = Math.round(Math.max(0, alpha) * 255);
    return hex + (a < 16 ? "0" : "") + a.toString(16);
  }
  function parseColors(toml) {
    const colors = {};
    for (const line of toml.split(`
`)) {
      const match = /^(\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/.exec(line.trim());
      if (match)
        colors[match[1]] = match[2].toLowerCase();
    }
    return colors;
  }
  var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function fromBase64(text) {
    let bits = 0;
    let value = 0;
    let out = "";
    for (const c of text) {
      const digit = BASE64.indexOf(c);
      if (digit < 0)
        continue;
      value = value << 6 | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode(value >> bits & 255);
      }
    }
    return out;
  }
  function apply(colors) {
    if (Object.keys(colors).length)
      setPalette({
        ...PALETTE,
        ...colors
      });
  }
  createRoot(() => createEffect(() => {
    const theme = state()?.theme;
    if (theme)
      apply(theme.colors);
  }));
  serve("shell", {
    applyTheme: (colorsB64) => (apply(parseColors(fromBase64(colorsB64 ?? ""))), "ok")
  });

  // shell/src/applets/activity.tsx
  var HISTORY = 60;
  var PROCESSES = 24;
  var [stats, setStats] = createSignal(null);
  var history = Array.from({
    length: HISTORY
  }, () => createSignal(0));
  var [head, setHead] = createSignal(0);
  var [procs, setProcs] = createSignal([]);
  var [sort, setSort] = createSignal("cpu");
  var [selected, setSelected] = createSignal(0);
  var [view, setView] = createSignal("stats");
  var polling = 0;
  var ticks = 0;
  function loadProcs(token) {
    request({
      method: "processes",
      sort: sort()
    }).then((p) => token === polling && setProcs(p.slice(0, PROCESSES)), () => {});
  }
  function poll(token) {
    if (token !== polling)
      return;
    request({
      method: "systemStats"
    }).then((s) => {
      if (token !== polling)
        return;
      batch(() => {
        setStats(s);
        history[head()][1](s.cpu);
        setHead((h) => (h + 1) % HISTORY);
      });
    }, () => {});
    if (ticks++ % 2 === 0 && view() === "processes")
      loadProcs(token);
    after(1, () => poll(token));
  }
  var mib = (kb) => kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GiB` : `${Math.round(kb / 1024)} MiB`;
  var rate = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB/s` : `${(bytes / 1024).toFixed(1)} kB/s`;
  function duration(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor(seconds % 86400 / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  }
  var load2 = (percent) => color(percent >= 85 ? "red" : percent >= 60 ? "yellow" : "accent");
  function Meter(props) {
    return [createComponent2(Text, {
      class: "absolute font-mono text-xs leading-[14]",
      get style() {
        return {
          insetL: props.x,
          insetT: props.y,
          textColor: color("dark_foreground")
        };
      },
      get children() {
        return props.label;
      }
    }), createComponent2(Text, {
      class: "absolute text-right font-mono text-xs leading-[14]",
      get style() {
        return {
          insetL: props.x,
          insetT: props.y,
          width: props.w,
          textColor: color("foreground")
        };
      },
      get children() {
        return props.value;
      }
    }), createComponent2(View, {
      class: "absolute h-[6] rounded-sm",
      get style() {
        return {
          insetL: props.x,
          insetT: props.y + 17,
          width: props.w,
          bgColor: color("selection")
        };
      }
    }), createComponent2(View, {
      class: "absolute h-[6] rounded-sm",
      get style() {
        return {
          insetL: props.x,
          insetT: props.y + 17,
          width: Math.max(2, props.w * Math.min(100, props.percent) / 100),
          bgColor: load2(props.percent)
        };
      }
    })];
  }
  var GRAPH_H = 64;
  function Stats(props) {
    const s = stats;
    const wide = () => props.w >= 420;
    const colW = () => wide() ? (props.w - 36) / 2 : props.w - 24;
    const cores = createMemo(() => s()?.cores.length ?? 4);
    const rightX = createMemo(() => wide() ? 24 + colW() : 12);
    const rightY = createMemo(() => wide() ? 8 : 88 + cores() * 32);
    const right = () => ({
      x: rightX(),
      y: rightY()
    });
    const mem = () => s() ? s().memUsed * 100 / Math.max(1, s().memTotal) : 0;
    const barW = () => colW() / HISTORY;
    return [createComponent2(Text, {
      class: "absolute left-[12] top-[8] text-sm leading-[16]",
      get style() {
        return {
          textColor: color("dark_foreground")
        };
      },
      children: "CPU"
    }), createComponent2(Text, {
      class: "absolute left-[12] top-[28] text-2xl leading-[28]",
      get style() {
        return {
          textColor: load2(s()?.cpu ?? 0)
        };
      },
      get children() {
        return `${s()?.cpu ?? 0}%`;
      }
    }), createComponent2(Text, {
      class: "absolute left-[12] top-[62] font-mono text-xs leading-[14]",
      get style() {
        return {
          textColor: color("dark_foreground")
        };
      },
      get children() {
        return memo2(() => !!s())() ? `${s().cores.length} cores  ${s().mhz} MHz` : "reading /proc...";
      }
    }), createComponent2(Index, {
      get each() {
        return s()?.cores ?? [];
      },
      children: (core, i) => createComponent2(Meter, {
        x: 12,
        y: 88 + i * 32,
        get w() {
          return colW();
        },
        label: `core ${i}`,
        get value() {
          return `${core()}%`;
        },
        get percent() {
          return core();
        }
      })
    }), createComponent2(Text, {
      class: "absolute text-sm leading-[16]",
      get style() {
        return {
          insetL: right().x,
          insetT: right().y,
          textColor: color("dark_foreground")
        };
      },
      children: "Last minute"
    }), createComponent2(View, {
      class: "absolute rounded-sm",
      get style() {
        return {
          insetL: right().x,
          insetT: right().y + 20,
          width: colW(),
          height: GRAPH_H + 4,
          bgColor: color("dark_background")
        };
      },
      get children() {
        return [createComponent2(For, {
          each: history,
          children: ([value], i) => createComponent2(View, {
            class: "absolute",
            get style() {
              return {
                insetL: i() * barW(),
                insetT: 2 + GRAPH_H - GRAPH_H * value() / 100,
                width: Math.max(1, barW() - 0.5),
                height: GRAPH_H * value() / 100,
                bgColor: load2(value())
              };
            }
          })
        }), createComponent2(View, {
          class: "absolute top-0 w-[2]",
          get style() {
            return {
              insetL: head() * barW(),
              height: GRAPH_H + 4,
              bgColor: color("bright_foreground", 0.5)
            };
          }
        })];
      }
    }), createComponent2(Meter, {
      get x() {
        return right().x;
      },
      get y() {
        return right().y + 98;
      },
      get w() {
        return colW();
      },
      label: "memory",
      get value() {
        return memo2(() => !!s())() ? `${mib(s().memUsed)} / ${mib(s().memTotal)}` : "";
      },
      get percent() {
        return mem();
      }
    }), createComponent2(Text, {
      class: "absolute font-mono text-sm leading-[16]",
      get style() {
        return {
          insetL: right().x,
          insetT: right().y + 134,
          textColor: color("green")
        };
      },
      get children() {
        return `\uDB80\uDDDA ${rate(s()?.rx ?? 0)}`;
      }
    }), createComponent2(Text, {
      class: "absolute font-mono text-sm leading-[16]",
      get style() {
        return {
          insetL: right().x + colW() / 2,
          insetT: right().y + 134,
          textColor: color("magenta")
        };
      },
      get children() {
        return `\uDB81\uDD52 ${rate(s()?.tx ?? 0)}`;
      }
    }), createComponent2(Index, {
      get each() {
        return (s()?.temps ?? []).slice(0, 3);
      },
      children: (t, i) => createComponent2(Text, {
        class: "absolute font-mono text-xs leading-[14]",
        get style() {
          return {
            insetL: rightX(),
            insetT: rightY() + 162 + i * 16,
            textColor: color(t().celsius >= 70 ? "red" : "foreground")
          };
        },
        get children() {
          return `${t().name.replace(/[-_]thermal$/, "").slice(0, 12).padEnd(13)}${t().celsius.toFixed(1)} °C`;
        }
      })
    }), createComponent2(Text, {
      class: "absolute font-mono text-xs leading-[14]",
      get style() {
        return {
          insetL: right().x,
          insetT: right().y + 216,
          textColor: color("foreground")
        };
      },
      get children() {
        return `up ${duration(s()?.uptime ?? 0)}   load ${s()?.load ?? ""}`;
      }
    })];
  }
  var ROW_H = 20;
  var LIST_T = 30;
  function Processes(props) {
    const count = () => Math.max(1, Math.floor((props.h - LIST_T - 4) / ROW_H));
    const first = () => Math.max(0, Math.min(selected() - count() + 1, procs().length - count()));
    const narrow = () => props.w < 300;
    return [createComponent2(Text, {
      class: "absolute left-[12] top-[8] font-mono text-xs leading-[14]",
      get style() {
        return {
          textColor: color("accent")
        };
      },
      get children() {
        return `by ${sort() === "cpu" ? "CPU" : "memory"}`;
      }
    }), createComponent2(Text, {
      class: "absolute right-[12] top-[8] font-mono text-xs leading-[14]",
      get style() {
        return {
          textColor: color("dark_foreground")
        };
      },
      get children() {
        return narrow() ? "CPU    MEM" : "PID      CPU       MEM";
      }
    }), createComponent2(For, {
      get each() {
        return procs().slice(first(), first() + count());
      },
      children: (p, i) => {
        const at = () => first() + i();
        return createComponent2(View, {
          class: "absolute rounded-sm",
          get style() {
            return {
              insetL: 6,
              insetT: LIST_T + i() * ROW_H,
              width: props.w - 12,
              height: ROW_H,
              bgColor: color(at() === selected() ? "selection" : "background")
            };
          },
          get children() {
            return [createComponent2(Text, {
              class: "absolute left-[6] top-[3] h-[14] overflow-hidden font-mono text-sm leading-[14]",
              get style() {
                return {
                  width: narrow() ? props.w - 136 : props.w - 200,
                  textColor: color(at() === selected() ? "bright_foreground" : "foreground")
                };
              },
              get children() {
                return p.name;
              }
            }), createComponent2(Text, {
              class: "absolute right-[6] top-[3] font-mono text-xs leading-[14]",
              get style() {
                return {
                  textColor: color("dark_foreground")
                };
              },
              get children() {
                return memo2(() => !!narrow())() ? `${p.cpu.toFixed(1).padStart(5)}% ${mib(p.rssKb).padStart(7)}` : `${String(p.pid).padStart(6)}  ${p.cpu.toFixed(1).padStart(5)}%  ${mib(p.rssKb).padStart(8)}`;
              }
            })];
          }
        });
      }
    })];
  }
  function Stage(props) {
    return memo2(() => memo2(() => view() === "stats")() ? createComponent2(Stats, {
      get w() {
        return props.w;
      },
      get h() {
        return props.h;
      }
    }) : createComponent2(Processes, {
      get w() {
        return props.w;
      },
      get h() {
        return props.h;
      }
    }));
  }
  function choose(id) {
    setSort(id);
    setSelected(0);
    loadProcs(polling);
  }
  function select(index) {
    setSelected(Math.max(0, Math.min(procs().length - 1, index)));
  }
  function toggleView() {
    setView((v) => v === "stats" ? "processes" : "stats");
    if (view() === "processes")
      loadProcs(polling);
  }
  register({
    id: "activity",
    title: "Activity",
    icon: "\uDB81\uDCC5",
    Stage,
    hint: () => view() === "stats" ? "Tab shows the processes" : "↑↓ move · ←→ by CPU or memory · Tab shows the stats",
    press(key) {
      if (key & BTN.TRIANGLE)
        toggleView();
      else if (key & BTN.UP)
        select(selected() - 1);
      else if (key & BTN.DOWN)
        select(selected() + 1);
      else if (key & BTN.LEFT)
        choose("cpu");
      else if (key & BTN.RIGHT)
        choose("mem");
    },
    shown() {
      poll(++polling);
    },
    hidden() {
      polling++;
    }
  });

  // shell/src/applets/clock.tsx
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var two = (n) => n < 10 ? `0${n}` : String(n);
  var [now, setNow] = createSignal(new Date);
  var civil = createMemo(() => {
    const d = now();
    return {
      hours: d.getHours(),
      minutes: d.getMinutes(),
      seconds: d.getSeconds(),
      day: d.getDay(),
      date: d.getDate(),
      month: d.getMonth(),
      year: d.getFullYear()
    };
  });
  var [banked, setBanked] = createSignal(0);
  var [since, setSince] = createSignal(null);
  var [month, setMonth] = createSignal(0);
  var [view2, setView2] = createSignal("clock");
  var ticking = 0;
  function tick(token) {
    if (token !== ticking)
      return;
    setNow(new Date);
    after(since() === null ? 0.5 : 0.1, () => tick(token));
  }
  var elapsed = () => banked() + (since() === null ? 0 : now().getTime() - since());
  function stopwatch() {
    const ms = elapsed();
    return `${two(Math.floor(ms / 60000))}:${two(Math.floor(ms % 60000 / 1000))}.${Math.floor(ms % 1000 / 100)}`;
  }
  function toggleStopwatch() {
    const start = since();
    if (start === null)
      setSince(Date.now());
    else {
      setBanked((b) => b + Date.now() - start);
      setSince(null);
    }
    setNow(new Date);
  }
  function resetStopwatch() {
    setBanked(0);
    setSince(since() === null ? null : Date.now());
    setNow(new Date);
  }
  var SEGMENTS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];
  var DIGIT_W = 52;
  var DIGIT_H = 96;
  var T = 9;
  var GAP = 14;
  var COLON = 28;
  var CLOCK_W = DIGIT_W * 4 + GAP * 2 + COLON;
  var HALF = (DIGIT_H - T) / 2;
  var BOX = [["a", T, 0, DIGIT_W - 2 * T, T], ["b", DIGIT_W - T, T, T, HALF - T / 2], ["c", DIGIT_W - T, HALF + T, T, HALF - T / 2], ["d", T, DIGIT_H - T, DIGIT_W - 2 * T, T], ["e", 0, HALF + T, T, HALF - T / 2], ["f", 0, T, T, HALF - T / 2], ["g", T, HALF, DIGIT_W - 2 * T, T]];
  var LEFTS = [0, DIGIT_W + GAP, DIGIT_W * 2 + GAP + COLON, DIGIT_W * 3 + GAP * 2 + COLON];
  function Digits(props) {
    return [createComponent2(Index, {
      each: LEFTS,
      children: (left, i) => createComponent2(For, {
        each: BOX,
        children: ([name, x, y, w, h]) => createComponent2(View, {
          class: "absolute rounded-sm",
          get style() {
            return {
              insetL: props.x + (left() + x) * props.s,
              insetT: props.y + y * props.s,
              width: w * props.s,
              height: h * props.s,
              bgColor: SEGMENTS[Number(props.text()[i])]?.includes(name) ? color("bright_foreground") : color("selection", 0.5)
            };
          }
        })
      })
    }), createComponent2(For, {
      each: [0.3, 0.65],
      children: (at) => createComponent2(View, {
        class: "absolute rounded-sm",
        get style() {
          return {
            insetL: props.x + (DIGIT_W * 2 + GAP + (COLON - 10) / 2) * props.s,
            insetT: props.y + DIGIT_H * at * props.s,
            width: 10 * props.s,
            height: 10 * props.s,
            bgColor: color("accent")
          };
        }
      })
    })];
  }
  var digits = createMemo(() => `${two(civil().hours)}${two(civil().minutes)}`);
  var CLOCK_H = 270;
  function ClockFace(props) {
    const s = () => Math.min(1, (props.w - 24) / CLOCK_W, (props.h - 20) / CLOCK_H);
    const top = () => props.y + Math.max(6, (props.h - CLOCK_H * s()) / 2);
    const digitsL = () => (props.w - CLOCK_W * s()) / 2;
    const below = () => top() + DIGIT_H * s() + 10;
    return [createComponent2(Digits, {
      text: digits,
      get x() {
        return digitsL();
      },
      get y() {
        return top();
      },
      get s() {
        return s();
      }
    }), createComponent2(Text, {
      class: "absolute left-0 text-center text-2xl leading-[28]",
      get style() {
        return {
          insetT: below(),
          width: props.w,
          textColor: color("accent")
        };
      },
      get children() {
        return two(civil().seconds);
      }
    }), createComponent2(Text, {
      class: "absolute left-0 h-[20] overflow-hidden text-center text-base leading-[20]",
      get style() {
        return {
          insetT: below() + 36,
          width: props.w,
          textColor: color("foreground")
        };
      },
      get children() {
        return memo2(() => props.w >= 300)() ? `${WEEKDAYS[civil().day]}, ${civil().date} ${MONTHS[civil().month]} ${civil().year}` : `${civil().date} ${MONTHS[civil().month].slice(0, 3)}`;
      }
    }), createComponent2(Show, {
      get when() {
        return props.h >= 230;
      },
      get children() {
        return createComponent2(Text, {
          class: "absolute left-0 text-center text-2xl leading-[28]",
          get style() {
            return {
              insetT: below() + 72,
              width: props.w,
              textColor: color(since() === null ? "dark_foreground" : "green")
            };
          },
          get children() {
            return stopwatch();
          }
        });
      }
    })];
  }
  function weeks(offset) {
    const today = now();
    const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const cells = [...Array.from({
      length: lead
    }, () => null), ...Array.from({
      length: days
    }, (_, i) => i + 1)];
    while (cells.length % 7)
      cells.push(null);
    const rows = [];
    for (let i = 0;i < cells.length; i += 7)
      rows.push(cells.slice(i, i + 7));
    return {
      first,
      rows
    };
  }
  var CELL_H = 26;
  var CAL_H = 22 + 16 + 6 * CELL_H;
  function Calendar(props) {
    const view = () => weeks(month());
    const cellW = () => Math.min(56, (props.w - 16) / 7);
    const gridL = () => (props.w - cellW() * 7) / 2;
    const isToday = (day) => month() === 0 && day === civil().date;
    return [createComponent2(Text, {
      class: "absolute left-0 h-[16] text-center font-mono text-sm leading-[16]",
      get style() {
        return {
          insetT: props.y,
          width: props.w,
          textColor: color("accent")
        };
      },
      get children() {
        return `\uDB80\uDD41  ${MONTHS[view().first.getMonth()]} ${view().first.getFullYear()}  \uDB80\uDD42`;
      }
    }), createComponent2(For, {
      each: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
      children: (d, i) => createComponent2(Text, {
        class: "absolute text-center font-mono text-xs leading-[14]",
        get style() {
          return {
            insetL: gridL() + i() * cellW(),
            insetT: props.y + 22,
            width: cellW(),
            textColor: color(i() >= 5 ? "magenta" : "dark_foreground")
          };
        },
        children: d
      })
    }), createComponent2(Index, {
      get each() {
        return view().rows;
      },
      children: (week, r) => createComponent2(Index, {
        get each() {
          return week();
        },
        children: (day, c) => createComponent2(Show, {
          get when() {
            return day() !== null;
          },
          get children() {
            return createComponent2(View, {
              class: "absolute rounded-sm",
              get style() {
                return {
                  insetL: gridL() + c * cellW() + 2,
                  insetT: props.y + 38 + r * CELL_H,
                  width: cellW() - 4,
                  height: CELL_H - 3,
                  bgColor: color(isToday(day()) ? "accent" : "dark_background")
                };
              },
              get children() {
                return createComponent2(Text, {
                  class: "absolute left-0 top-[4] text-center font-mono text-sm leading-[16]",
                  get style() {
                    return {
                      width: cellW() - 4,
                      textColor: color(isToday(day()) ? "background" : c >= 5 ? "magenta" : "foreground")
                    };
                  },
                  get children() {
                    return String(day());
                  }
                });
              }
            });
          }
        })
      })
    })];
  }
  function Stage2(props) {
    const both = () => props.h >= 190 + CAL_H;
    return [createComponent2(Show, {
      get when() {
        return both() || view2() === "clock";
      },
      get children() {
        return createComponent2(ClockFace, {
          get w() {
            return props.w;
          },
          get h() {
            return memo2(() => !!both())() ? props.h - CAL_H : props.h;
          },
          y: 0
        });
      }
    }), createComponent2(Show, {
      get when() {
        return both() || view2() === "calendar";
      },
      get children() {
        return createComponent2(Calendar, {
          get w() {
            return props.w;
          },
          get y() {
            return memo2(() => !!both())() ? props.h - CAL_H : Math.max(6, (props.h - CAL_H) / 2);
          }
        });
      }
    })];
  }
  register({
    id: "clock",
    title: "Clock",
    icon: "\uDB82\uDD54",
    Stage: Stage2,
    hint: () => "←→ turn the month · B this month · Enter stopwatch · Y resets · Tab turns the page",
    press(key) {
      if (key & BTN.LEFT)
        setMonth((m) => m - 1);
      else if (key & BTN.RIGHT)
        setMonth((m) => m + 1);
      else if (key & BTN.CROSS)
        setMonth(0);
      else if (key & BTN.CIRCLE)
        toggleStopwatch();
      else if (key & BTN.SQUARE)
        resetStopwatch();
      else if (key & BTN.TRIANGLE)
        setView2((v) => v === "clock" ? "calendar" : "clock");
    },
    shown() {
      tick(++ticking);
    },
    hidden() {
      ticking++;
    }
  });

  // shell/src/stage/toasts.tsx
  var LIMIT = 3;
  var BELL = "\uDB80\uDC9A";
  var [toasts, setToasts] = createSignal([]);
  var nextLocal = -1;
  function put(toast) {
    setToasts((list) => [toast, ...list.filter((t) => t.id !== toast.id)]);
  }
  function drop(id) {
    setToasts((list) => list.filter((t) => t.id !== id));
  }
  function toast(notice, seconds = notice.tone === "error" ? 8 : 4) {
    const id = nextLocal--;
    put({
      ...notice,
      id
    });
    after(seconds, () => drop(id));
  }
  onEvent((event) => {
    if (event.event === "notify") {
      const n = event.notice;
      put({
        id: n.id,
        icon: n.glyph || BELL,
        title: n.summary,
        body: n.body.split(`
`)[0] ?? "",
        tone: n.urgency === 2 ? "error" : "info",
        actionable: true
      });
    } else if (event.event === "notifyClosed")
      drop(event.notice);
  });
  function Toasts() {
    return createComponent2(For, {
      get each() {
        return toasts().slice(0, LIMIT);
      },
      children: (t, index) => createComponent2(View, {
        get ["class"]() {
          return C.toast;
        },
        get style() {
          return {
            insetT: 24 + index() * 58,
            bgColor: color("background", 0.97),
            borderColor: color(t.tone === "error" ? "red" : "accent")
          };
        },
        get children() {
          return [createComponent2(Text, {
            get ["class"]() {
              return C.toastIcon;
            },
            get style() {
              return {
                textColor: color(t.tone === "error" ? "red" : "accent")
              };
            },
            get children() {
              return t.icon;
            }
          }), createComponent2(Text, {
            get ["class"]() {
              return C.toastTitle;
            },
            get style() {
              return {
                textColor: color("bright_foreground")
              };
            },
            get children() {
              return t.title;
            }
          }), createComponent2(Text, {
            get ["class"]() {
              return C.toastBody;
            },
            get style() {
              return {
                textColor: color("foreground")
              };
            },
            get children() {
              return t.body;
            }
          }), createComponent2(Show, {
            get when() {
              return memo2(() => index() === 0)() && t.actionable;
            },
            get children() {
              return createComponent2(Text, {
                get ["class"]() {
                  return C.toastKeys;
                },
                get style() {
                  return {
                    textColor: color("dark_foreground")
                  };
                },
                children: "Y open X close"
              });
            }
          })];
        }
      })
    });
  }

  // shell/src/applets/notes.tsx
  var [names, setNames] = createSignal([]);
  var [selected2, setSelected2] = createSignal(0);
  var [preview, setPreview] = createSignal("");
  var [editing, setEditing] = createSignal(null);
  var [chars, setChars] = createSignal([]);
  var [cursor2, setCursor] = createSignal(0);
  var edits = 0;
  var saved = 0;
  var NEW = "New note";
  var rowsOf = () => [NEW, ...names().map((n) => n.replace(/\.md$/, ""))];
  var fail2 = (error) => toast({
    icon: "\uDB80\uDD5A",
    title: "Notes",
    body: String(error).replace(/^Error: /, ""),
    tone: "error"
  });
  function reload() {
    request({
      method: "notes"
    }).then((list) => {
      setNames(list);
      setSelected2((s) => Math.min(s, list.length));
      loadPreview();
    }, fail2);
  }
  var previewing = 0;
  function loadPreview() {
    const mine = ++previewing;
    const name = names()[selected2() - 1];
    if (!name)
      return setPreview("");
    after(0.2, () => {
      if (mine === previewing)
        request({
          method: "noteRead",
          name
        }).then((text) => mine === previewing && setPreview(text), () => {});
    });
  }
  function open2(index) {
    const name = index === 0 ? newName() : names()[index - 1];
    if (!name)
      return;
    const start = (text) => {
      setEditing(name);
      setChars([...text]);
      setCursor(text.length ? [...text].length : 0);
      edits = saved = 0;
    };
    if (index === 0)
      start("");
    else
      request({
        method: "noteRead",
        name
      }).then(start, fail2);
  }
  function newName() {
    const d = new Date;
    const two = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.md`;
  }
  function save() {
    const name = editing();
    if (!name || saved === edits)
      return;
    const at = edits;
    request({
      method: "noteWrite",
      name,
      text: chars().join("")
    }).then(() => saved = Math.max(saved, at), fail2);
  }
  function changed() {
    const at = ++edits;
    after(1, () => at === edits && save());
  }
  function closeNote() {
    save();
    setEditing(null);
    reload();
  }
  function lineAt(list, at) {
    let start = at;
    while (start > 0 && list[start - 1] !== `
`)
      start--;
    let end = at;
    while (end < list.length && list[end] !== `
`)
      end++;
    return {
      start,
      end
    };
  }
  function insert2(text) {
    const at = cursor2();
    const add = [...text];
    setChars((list) => [...list.slice(0, at), ...add, ...list.slice(at)]);
    setCursor(at + add.length);
    changed();
  }
  function key2(name) {
    const list = chars();
    const at = cursor2();
    switch (name) {
      case "Enter":
        return insert2(`
`);
      case "Tab":
        return insert2("  ");
      case "Backspace":
        if (!at)
          return;
        setChars([...list.slice(0, at - 1), ...list.slice(at)]);
        setCursor(at - 1);
        return changed();
      case "Delete":
        if (at >= list.length)
          return;
        setChars([...list.slice(0, at), ...list.slice(at + 1)]);
        return changed();
      case "Left":
        return setCursor(Math.max(0, at - 1));
      case "Right":
        return setCursor(Math.min(list.length, at + 1));
      case "Home":
        return setCursor(lineAt(list, at).start);
      case "End":
        return setCursor(lineAt(list, at).end);
      case "Up":
      case "Down": {
        const line = lineAt(list, at);
        const column = at - line.start;
        if (name === "Up") {
          if (!line.start)
            return setCursor(0);
          const above = lineAt(list, line.start - 1);
          return setCursor(Math.min(above.end, above.start + column));
        }
        if (line.end >= list.length)
          return setCursor(list.length);
        const below = lineAt(list, line.end + 1);
        return setCursor(Math.min(below.end, below.start + column));
      }
      case "Escape":
        return closeNote();
    }
  }
  var sink = {
    text: insert2,
    key: (name) => key2(name),
    close: closeNote,
    hint: () => "editing · Esc or \uDB80\uDD56 closes · A newline · B Bksp · Y space"
  };
  var LINE_H = 18;
  var TOP = 26;
  var wide = (ch) => ch.codePointAt(0) >= 4352;
  var advance = (ch) => wide(ch) ? 14 : 8.4;
  function wrap2(list, width) {
    const lines = [];
    let line = {
      start: 0,
      text: "",
      xs: [0]
    };
    for (let i = 0;i < list.length; i++) {
      const ch = list[i];
      if (ch === `
`) {
        lines.push(line);
        line = {
          start: i + 1,
          text: "",
          xs: [0]
        };
        continue;
      }
      const x = line.xs[line.xs.length - 1];
      if (x + advance(ch) > width && line.text) {
        lines.push(line);
        line = {
          start: i,
          text: "",
          xs: [0]
        };
      }
      line.text += ch;
      line.xs.push(line.xs[line.xs.length - 1] + advance(ch));
    }
    lines.push(line);
    return lines;
  }
  function Page(props) {
    const lines = createMemo(() => wrap2(props.chars(), props.w - 24));
    const count = () => Math.max(1, Math.floor((props.h - TOP - 6) / LINE_H));
    const caret = () => {
      const at = props.cursor?.();
      if (at === undefined)
        return null;
      const list = lines();
      let row = list.length - 1;
      for (let i = 0;i < list.length; i++) {
        if (list[i].start > at) {
          row = i - 1;
          break;
        }
      }
      const line = list[Math.max(0, row)];
      return {
        row: Math.max(0, row),
        x: line.xs[Math.min(line.xs.length - 1, at - line.start)] ?? 0
      };
    };
    const first = () => {
      const c = caret();
      return c ? Math.max(0, c.row - count() + 1) : 0;
    };
    return [createComponent2(Text, {
      class: "absolute top-[6] h-[14] overflow-hidden font-mono text-xs leading-[14]",
      get style() {
        return {
          insetL: props.x + 12,
          width: props.w - 24,
          textColor: color("dark_foreground"),
          ...cjk(props.title, CJK_SLOT_14)
        };
      },
      get children() {
        return props.title;
      }
    }), createComponent2(For, {
      get each() {
        return lines().slice(first(), first() + count());
      },
      children: (line, i) => createComponent2(Text, {
        class: "absolute h-[18] overflow-hidden font-mono text-sm leading-[18]",
        get style() {
          return {
            insetL: props.x + 12,
            insetT: TOP + i() * LINE_H,
            width: props.w - 20,
            textColor: color("foreground"),
            ...cjk(line.text, CJK_SLOT_14)
          };
        },
        get children() {
          return line.text;
        }
      })
    }), createComponent2(Show, {
      get when() {
        return caret();
      },
      children: (c) => createComponent2(View, {
        class: "absolute w-[2] h-[16]",
        get style() {
          return {
            insetL: props.x + 12 + c().x,
            insetT: TOP + 1 + (c().row - first()) * LINE_H,
            bgColor: color("accent")
          };
        }
      })
    })];
  }
  var ROW_H2 = 22;
  var LIST_W = 180;
  function Rows(props) {
    const count = () => Math.max(1, Math.floor((props.h - TOP - 4) / ROW_H2));
    const first = () => Math.max(0, Math.min(selected2() - count() + 1, rowsOf().length - count()));
    return [createComponent2(Text, {
      class: "absolute left-[12] top-[6] font-mono text-xs leading-[14]",
      get style() {
        return {
          textColor: color("dark_foreground")
        };
      },
      get children() {
        return `Notes  ${names().length}`;
      }
    }), createComponent2(For, {
      get each() {
        return rowsOf().slice(first(), first() + count());
      },
      children: (label, i) => {
        const at = () => first() + i();
        return createComponent2(View, {
          class: "absolute rounded-sm",
          get style() {
            return {
              insetL: 6,
              insetT: TOP + i() * ROW_H2,
              width: props.w - 12,
              height: ROW_H2,
              bgColor: color(at() === selected2() ? "selection" : "background")
            };
          },
          get children() {
            return [createComponent2(Text, {
              class: "absolute left-[6] top-[4] w-[16] font-mono text-sm leading-[14]",
              get style() {
                return {
                  textColor: color(at() === selected2() ? "accent" : "dark_foreground")
                };
              },
              get children() {
                return at() === 0 ? "\uDB81\uDC15" : "\uDB82\uDDED";
              }
            }), createComponent2(Text, {
              class: "absolute left-[26] top-[4] h-[14] overflow-hidden font-mono text-sm leading-[14]",
              get style() {
                return {
                  width: props.w - 40,
                  textColor: color(at() === selected2() ? "bright_foreground" : "foreground"),
                  ...cjk(label, CJK_SLOT_14)
                };
              },
              children: label
            })];
          }
        });
      }
    })];
  }
  function Stage3(props) {
    const split = () => props.w >= 360;
    return createComponent2(Show, {
      get when() {
        return editing();
      },
      get fallback() {
        return [createComponent2(Rows, {
          get w() {
            return memo2(() => !!split())() ? LIST_W : props.w;
          },
          get h() {
            return props.h;
          }
        }), createComponent2(Show, {
          get when() {
            return split();
          },
          get children() {
            return [createComponent2(View, {
              class: "absolute top-0 w-[1]",
              get style() {
                return {
                  insetL: LIST_W,
                  height: props.h,
                  bgColor: color("muted")
                };
              }
            }), createComponent2(Page, {
              chars: () => [...preview()],
              get title() {
                return names()[selected2() - 1]?.replace(/\.md$/, "") ?? "Enter opens a new note";
              },
              x: LIST_W,
              get w() {
                return props.w - LIST_W;
              },
              get h() {
                return props.h;
              }
            })];
          }
        })];
      },
      get children() {
        return createComponent2(Page, {
          chars,
          cursor: cursor2,
          get title() {
            return `${(editing() ?? "").replace(/\.md$/, "")}  (editing)`;
          },
          x: 0,
          get w() {
            return props.w;
          },
          get h() {
            return props.h;
          }
        });
      }
    });
  }
  function select2(index) {
    const next = Math.max(0, Math.min(rowsOf().length - 1, index));
    if (next === selected2())
      return;
    setSelected2(next);
    loadPreview();
  }
  register({
    id: "notes",
    title: "Notes",
    icon: "\uDB82\uDDED",
    Stage: Stage3,
    keys: () => editing() ? sink : null,
    hint: () => "↑↓ pick a note · Enter opens it",
    press(button) {
      if (button & BTN.UP)
        select2(selected2() - 1);
      else if (button & BTN.DOWN)
        select2(selected2() + 1);
      else if (button & BTN.CIRCLE)
        open2(selected2());
    },
    shown: reload,
    hidden: save
  });

  // shell/src/applets/pictures.tsx
  var [list, setList] = createSignal([]);
  var [selected3, setSelected3] = createSignal(0);
  var [fill, setFill] = createSignal(false);
  var [shown2, setShown] = createSignal(null);
  var [status, setStatus] = createSignal("");
  var nodes2 = [];
  var handles = [];
  var wanted = 0;
  function apply2() {
    if (handles.length === nodes2.length && nodes2.every((n) => n))
      handles.forEach((handle, i) => getOps().setImage(nodes2[i].id, handle));
  }
  function release2() {
    for (const h of handles)
      getOps().freeTexture?.(h);
    handles = [];
    setShown(null);
  }
  function show() {
    const mine = ++wanted;
    after(0.25, async () => {
      const picture = list()[selected3()];
      if (mine !== wanted || !picture)
        return;
      setStatus("Loading...");
      let tiles;
      try {
        tiles = await request({
          method: "wallpaper",
          path: picture.path,
          fit: !fill()
        });
      } catch (error) {
        setStatus(String(error).replace(/^Error: /, ""));
        return;
      }
      if (mine !== wanted)
        return;
      const bridge = globalThis.omarchyBridge;
      const next = tiles.map((t) => bridge?.loadTexture(t.file, t.w, t.h) ?? -1);
      if (next.some((h) => h < 0) || nodes2.some((n) => !n)) {
        for (const h of next)
          if (h >= 0)
            getOps().freeTexture?.(h);
        setStatus("The textures did not load");
        return;
      }
      for (const h of handles)
        getOps().freeTexture?.(h);
      handles = next;
      apply2();
      setShown(picture.path);
      setStatus("");
    });
  }
  function reload2() {
    request({
      method: "pictures"
    }).then((pictures) => {
      const path = list()[selected3()]?.path;
      setList(pictures);
      setSelected3(Math.max(0, pictures.findIndex((p) => p.path === path)));
      if (pictures.length)
        show();
      else
        setStatus("No pictures in ~/Pictures");
    }, (error) => setStatus(String(error)));
  }
  var CAPTION_H = 18;
  function Stage4(props) {
    const frameH = () => props.h - CAPTION_H;
    const scale = () => Math.min(props.w / 512, frameH() / 384);
    const ox = () => (props.w - 512 * scale()) / 2;
    const oy = () => (frameH() - 384 * scale()) / 2;
    const tile = (col, row) => ({
      insetL: ox() + col * 256 * scale(),
      insetT: oy() + row * 256 * scale(),
      width: 256 * scale(),
      height: (row ? 128 : 256) * scale()
    });
    const picture = () => list()[selected3()];
    onMount(apply2);
    return createComponent2(View, {
      class: "absolute left-0 top-0",
      get style() {
        return {
          width: props.w,
          height: props.h,
          bgColor: "#000000"
        };
      },
      get children() {
        return [createComponent2(View, {
          class: "absolute left-0 top-0",
          get style() {
            return {
              width: props.w,
              height: frameH(),
              opacity: shown2() ? 1 : 0
            };
          },
          get children() {
            return [createComponent2(Image, {
              ref: (n) => nodes2[0] = n,
              class: "absolute",
              get style() {
                return tile(0, 0);
              },
              src: "wall-0-0.png"
            }), createComponent2(Image, {
              ref: (n) => nodes2[1] = n,
              class: "absolute",
              get style() {
                return tile(1, 0);
              },
              src: "wall-1-0.png"
            }), createComponent2(Image, {
              ref: (n) => nodes2[2] = n,
              class: "absolute",
              get style() {
                return tile(0, 1);
              },
              src: "wall-0-1.png"
            }), createComponent2(Image, {
              ref: (n) => nodes2[3] = n,
              class: "absolute",
              get style() {
                return tile(1, 1);
              },
              src: "wall-1-1.png"
            })];
          }
        }), createComponent2(Show, {
          get when() {
            return status();
          },
          get children() {
            return createComponent2(Text, {
              class: "absolute left-0 text-center font-mono text-sm leading-[16]",
              get style() {
                return {
                  insetT: frameH() / 2 - 8,
                  width: props.w,
                  textColor: color("foreground")
                };
              },
              get children() {
                return status();
              }
            });
          }
        }), createComponent2(View, {
          class: "absolute left-0",
          get style() {
            return {
              insetT: frameH(),
              width: props.w,
              height: CAPTION_H,
              bgColor: color("background")
            };
          },
          get children() {
            return [createComponent2(Text, {
              class: "absolute left-[8] top-[2] h-[14] overflow-hidden font-mono text-xs leading-[14]",
              get style() {
                return {
                  width: props.w - 100,
                  textColor: color("foreground"),
                  ...cjk(picture()?.name ?? "", CJK_SLOT_14)
                };
              },
              get children() {
                return memo2(() => !!picture())() ? `${picture().group === "Backgrounds" ? "\uDB80\uDEE9" : "\uDB80\uDD00"} ${picture().name}` : "";
              }
            }), createComponent2(Text, {
              class: "absolute right-[8] top-[2] font-mono text-xs leading-[14]",
              get style() {
                return {
                  textColor: color("dark_foreground")
                };
              },
              get children() {
                return `${list().length ? selected3() + 1 : 0}/${list().length}${fill() ? "  filled" : ""}`;
              }
            })];
          }
        })];
      }
    });
  }
  function setBackground() {
    const picture = list()[selected3()];
    if (!picture)
      return;
    run(`omarchy-theme-bg-set ${quote(picture.path)}`).then((r) => toast({
      icon: "\uDB80\uDEE9",
      title: "Background",
      body: r.code === 0 ? picture.name : r.stderr.trim().split(`
`).pop() ?? "failed",
      tone: r.code === 0 ? "info" : "error"
    }), () => {});
  }
  function select3(index) {
    const next = Math.max(0, Math.min(list().length - 1, index));
    if (next === selected3())
      return;
    setSelected3(next);
    show();
  }
  function toggleFill() {
    setFill((f) => !f);
    show();
  }
  register({
    id: "pictures",
    title: "Pictures",
    icon: "\uDB80\uDEE9",
    Stage: Stage4,
    hint: () => "↑↓ next picture · Enter fills the panel · Tab sets it as the background",
    press(key) {
      if (key & BTN.UP)
        select3(selected3() - 1);
      else if (key & BTN.DOWN)
        select3(selected3() + 1);
      else if (key & BTN.CIRCLE)
        toggleFill();
      else if (key & BTN.TRIANGLE)
        setBackground();
    },
    shown: reload2,
    hidden() {
      wanted++;
      release2();
    }
  });

  // shell/src/watch.ts
  var frames = 0;
  var watching = () => frames > 0;
  function watchFor(n) {
    frames = n;
  }
  function watchTick() {
    if (frames <= 0)
      return false;
    frames--;
    return true;
  }

  // shell/src/packages.ts
  var host2 = globalThis.omarchyBridge;
  var [textures2, setTextures] = createSignal({});
  var appTextures = (id) => textures2()[id] ?? null;
  var [playing, setPlaying] = createSignal(new Set);
  var mediaPlaying = () => playing().size > 0;
  var [typing, setTyping] = createSignal(new Set);
  var appletTyping = (id) => typing().has(id);
  var ARROWS = {
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight"
  };
  function appletKeys(id) {
    return {
      text: (ch) => {
        if (watching())
          console.log(`app ${id} text ${JSON.stringify(ch)}`);
        host2?.appText?.(id, "text", ch);
      },
      key: (name) => {
        if (watching())
          console.log(`app ${id} key ${ARROWS[name] ?? name}`);
        host2?.appText?.(id, "key", ARROWS[name] ?? name);
      },
      close: () => host2?.appText?.(id, "key", "Escape"),
      hint: () => "types into the window above · × closes its field"
    };
  }
  var BACK_FRAMES = 3;
  var backFor = 0;
  var pressBack = () => {
    backFor = BACK_FRAMES;
  };
  function touchAppButtons() {
    if (backFor === 0)
      return 0;
    backFor--;
    return BTN.CROSS;
  }
  var BASELINE = [320, 240];
  var MAX = [640, 720];
  var MIN_SCALE = 0.6;
  function fitSurface(w, h) {
    if (w >= BASELINE[0] && h >= BASELINE[1])
      return {
        w: Math.min(MAX[0], Math.floor(w)),
        h: Math.min(MAX[1], Math.floor(h)),
        scale: 1
      };
    const scale = Math.min(w / BASELINE[0], h / BASELINE[1]);
    if (scale < MIN_SCALE)
      return null;
    return {
      w: Math.min(MAX[0], Math.round(w / scale)),
      h: Math.min(MAX[1], Math.round(h / scale)),
      scale
    };
  }
  var [sized, setSized] = createSignal({});
  var appletFit = (id) => sized()[id];
  var appletRefused = (id) => sized()[id] === null;
  function sizeApplet(id, fit) {
    const last = sized()[id];
    if (fit && last && fit.w === last.w && fit.h === last.h)
      return;
    if (fit === null && last === null)
      return;
    setSized((s) => ({
      ...s,
      [id]: fit
    }));
    if (fit)
      host2?.resizeApp?.(id, fit.w, fit.h);
  }
  var ERROR2 = "\uDB80\uDD5A";
  var isApp = (id) => (w) => w.kind === "app" && w.app === id;
  function openPackage(path, title, aux, applet = false) {
    const id = host2?.openApp?.(path) ?? -1;
    if (id < 0)
      return toast({
        icon: ERROR2,
        title,
        body: "This host cannot run packages",
        tone: "error"
      });
    open({
      kind: "app",
      app: id,
      path,
      title,
      aux,
      appletSurface: applet
    });
  }
  function closePackage(id) {
    host2?.closeApp?.(id);
    const w = find(isApp(id));
    if (w)
      closeWindow(w.id);
    setTextures(({
      [id]: _,
      ...rest
    }) => rest);
    setSized(({
      [id]: _,
      ...rest
    }) => rest);
  }
  function showPackage(id, visible) {
    host2?.showApp?.(id, visible);
  }
  function feedPackage(id, buttons, contacts) {
    host2?.appInput?.(id, buttons, contacts);
  }
  onEvent((event) => {
    if (event.event === "app") {
      if (event.textures)
        setTextures((t) => ({
          ...t,
          [event.id]: event.textures
        }));
      else if (typeof event.media === "boolean") {
        setPlaying((set) => {
          const next = new Set(set);
          if (event.media)
            next.add(event.id);
          else
            next.delete(event.id);
          return next;
        });
      } else if (typeof event.typing === "boolean") {
        setTyping((set) => {
          const next = new Set(set);
          if (event.typing)
            next.add(event.id);
          else
            next.delete(event.id);
          return next;
        });
      } else {
        const w = find(isApp(event.id));
        toast({
          icon: ERROR2,
          title: w?.kind === "app" ? w.title : "Package",
          body: event.error ?? "did not start",
          tone: "error"
        });
        if (w)
          closeWindow(w.id);
      }
    } else if (event.event === "appExit") {
      const w = find(isApp(event.id));
      toast({
        icon: ERROR2,
        title: w?.kind === "app" ? `${w.title} stopped` : "Package stopped",
        body: event.error,
        tone: "error"
      });
      if (w)
        closeWindow(w.id);
      setTextures(({
        [event.id]: _,
        ...rest
      }) => rest);
      setPlaying((set) => {
        const next = new Set(set);
        next.delete(event.id);
        return next;
      });
      setTyping((set) => {
        const next = new Set(set);
        next.delete(event.id);
        return next;
      });
    }
  });

  // shell/src/term/store.ts
  var awaitingRows = new Set;
  var [sessions, setSessions] = createSignal([]);
  var active = () => {
    const w = focused2();
    return w?.kind === "terminal" ? w.sid : null;
  };
  function session(sid, title) {
    const existing = sessions().find((s) => s.sid === sid);
    if (existing)
      return existing;
    const [t, setTitle] = createSignal(title);
    const rows = [];
    const setRows = [];
    for (let y = 0;y < TERM_ROWS; y++) {
      const [row, setRow] = createSignal([]);
      rows.push(row);
      setRows.push(setRow);
    }
    const [cursor, setCursor] = createSignal([0, 0, 1]);
    const created = {
      sid,
      title: t,
      setTitle,
      rows,
      setRows,
      cursor,
      setCursor
    };
    setSessions((list) => [...list, created]);
    return created;
  }
  var terminalSink = {
    text: (text) => {
      const sid = active();
      if (watching())
        console.log(`term ${sid} input ${JSON.stringify(text)}`);
      if (sid !== null)
        request({
          method: "termInput",
          sid,
          text
        });
    },
    key: (key, m) => {
      const sid = active();
      if (sid !== null)
        request({
          method: "termKey",
          sid,
          key,
          ctrl: m.ctrl,
          alt: m.alt,
          shift: m.shift
        });
    },
    hint: () => "A Enter · B Backspace · X Tab · Y Space · START Esc"
  };
  var isSession = (sid) => (w) => w.kind === "terminal" && w.sid === sid;
  function windowFor(sid) {
    const existing = find(isSession(sid));
    if (existing)
      focusWindow(existing.id);
    else
      open({
        kind: "terminal",
        sid
      });
  }
  var sessionById = (sid) => sessions().find((s) => s.sid === sid) ?? null;
  function openTerminal(argv, title = "bash") {
    if (watching())
      console.log(`term open asked: ${title}`);
    request({
      method: "termOpen",
      ...argv ? {
        argv,
        title
      } : {}
    }).then((sid) => {
      if (watching()) {
        console.log(`term ${sid} opened`);
        awaitingRows.add(sid);
      }
      session(sid, title);
      windowFor(sid);
    }, () => {});
  }
  function closeTerminal(sid) {
    request({
      method: "termClose",
      sid
    });
  }
  function resizeTerminal(sid, cols, rows) {
    request({
      method: "termResize",
      sid,
      cols,
      rows
    });
  }
  onEvent((event) => {
    switch (event.event) {
      case "termOpened":
        session(event.sid, event.title);
        windowFor(event.sid);
        break;
      case "termRows": {
        if (awaitingRows.delete(event.sid))
          console.log(`term ${event.sid} first rows: ${event.rows.length}`);
        const s = session(event.sid, "");
        for (const [y, runs] of event.rows)
          s.setRows[y]?.(runs);
        s.setCursor(event.cursor);
        break;
      }
      case "termTitle":
        session(event.sid, event.title).setTitle(event.title);
        break;
      case "termExit": {
        setSessions(sessions().filter((s) => s.sid !== event.sid));
        const existing = find(isSession(event.sid));
        if (existing)
          closeWindow(existing.id);
        break;
      }
    }
  });
  function reconcile() {
    request({
      method: "termList"
    }).then((list) => {
      const live = new Set(list.map((s) => s.sid));
      setSessions(sessions().filter((s) => live.has(s.sid)));
      for (const s of list) {
        session(s.sid, s.title).setTitle(s.title);
        if (!find(isSession(s.sid)))
          open({
            kind: "terminal",
            sid: s.sid
          });
      }
      for (;; ) {
        const dead = find((w) => w.kind === "terminal" && !live.has(w.sid));
        if (!dead)
          break;
        closeWindow(dead.id);
      }
    }, () => {});
  }
  onEvent((event) => {
    if (event.event === "hello")
      reconcile();
  });

  // shell/src/windows.ts
  function openWindow(name) {
    if (name === "terminal")
      openTerminal();
    else if (name === "agent")
      openTerminal(["omarchy-agent", "--inline", "--pick"], "Agent");
    else if (appletById(name))
      openApplet(name);
    else if (name)
      openPackageNamed(name);
    else
      return false;
    return true;
  }
  function openPackageNamed(name) {
    const wanted = name.toLowerCase();
    request({
      method: "apps"
    }).then((apps) => {
      const app = apps.find((a) => {
        const id = a.id.toLowerCase();
        return id === wanted || id === `${wanted}.pocket` || a.name.toLowerCase() === wanted;
      });
      if (app?.applet)
        openPackage(app.applet, app.name, app.aux === true, app.appletSurface === true);
    });
  }
  serve("pocket.window", {
    open: (name) => openWindow(name ?? "") ? "ok" : `no window ${name}`,
    focus: (n) => (focus(Number(n) - 1), "ok"),
    list: () => Array.from({
      length: WORKSPACES
    }, (_, i) => {
      const names = windowsOn(i).map((w) => `${w.kind === "terminal" ? `terminal:${w.sid}` : w.kind === "app" ? `app:${w.app}:${w.title}` : w.applet}${focused2()?.id === w.id ? "*" : ""}`);
      return `${i + 1}${i === current4() ? ">" : " "} ${names.join(" ") || "-"}`;
    }).join(`
`),
    focused: () => JSON.stringify(focused2()),
    applets: () => applets().map((a) => a.id).join(" "),
    slow: (factor) => (setSlowMotion(Number(factor) || 1), "ok"),
    closeapp: (id) => (closePackage(Number(id)), "ok"),
    app: (path, title, aux) => {
      const running = find((w) => w.kind === "app" && w.path === path);
      if (running?.kind === "app")
        closePackage(running.app);
      openPackage(path ?? "", title || (path ?? "").split("/").pop().replace(/\.pocket$/, ""), aux === "aux" || aux === "applet", aux === "applet");
      return "ok";
    }
  });

  // shell/src/stage/geometry.ts
  var CARD_W = 360;
  var CARD_H = 296;
  var CARD_X = (512 - CARD_W) / 2;
  var CARD_Y = 18 + (366 - CARD_H) / 2;

  // shell/src/deck/list.tsx
  function createList(rowH, top, rows, initial = 0) {
    const [first, setFirst] = createSignal(initial);
    let exact = initial;
    let column;
    let dragging = false;
    const clampTo = (count, v) => Math.max(0, Math.min(Math.max(0, count - rows), v));
    return {
      first,
      rows,
      bind(node) {
        column = node;
      },
      reveal(index, count) {
        let next = first();
        if (index < next)
          next = index;
        else if (index >= next + rows)
          next = index - rows + 1;
        next = clampTo(count, next);
        exact = next;
        setFirst(next);
      },
      touch(frame, count, pick) {
        const bottom = top + rows * rowH;
        const finger = frame.down.find((c) => c.moved && c.start.y >= top && c.start.y < bottom);
        if (finger) {
          dragging = true;
          exact = clampTo(count, exact - finger.dy / rowH);
          place(column, "translateY", -exact * rowH);
        } else if (dragging && !frame.down.length) {
          dragging = false;
          const settled = Math.round(exact);
          exact = settled;
          if (settled === first())
            glide(column, "translateY", -settled * rowH);
          setFirst(settled);
        }
        for (const t of frame.taps) {
          if (t.moved || t.y < top || t.y >= bottom)
            continue;
          const index = first() + Math.floor((t.y - top) / rowH);
          if (index < count)
            pick(index);
        }
      },
      reset() {
        exact = 0;
        setFirst(0);
      }
    };
  }
  function List(props) {
    let column;
    let bar;
    const left = props.left ?? 8;
    const width = props.width ?? 496;
    const startY = untrack(() => -props.state.first() * props.rowH);
    const startBar = untrack(() => props.selected() * props.rowH);
    createEffect(on(props.state.first, (first) => glide(column, "translateY", -first * props.rowH), {
      defer: true
    }));
    createEffect(on(props.selected, (i) => glide(bar, "translateY", i * props.rowH, 110), {
      defer: true
    }));
    return createComponent2(View, {
      class: "absolute overflow-hidden contain-strict",
      get style() {
        return {
          insetL: left,
          insetT: props.top,
          width,
          height: props.state.rows * props.rowH
        };
      },
      get children() {
        return createComponent2(View, {
          class: "absolute left-0 top-0",
          get style() {
            return {
              width,
              height: Math.max(1, props.items().length) * props.rowH,
              translateY: startY
            };
          },
          ref: (node) => {
            column = node;
            props.state.bind(node);
          },
          get children() {
            return [createComponent2(View, {
              class: "absolute left-0 top-0 rounded-sm",
              get style() {
                return {
                  width,
                  height: props.rowH,
                  bgColor: color("selection"),
                  opacity: props.selected() >= 0 && props.items().length ? 1 : 0,
                  translateY: startBar
                };
              },
              ref: (node) => bar = node
            }), createComponent2(Index, {
              get each() {
                return props.items();
              },
              children: (item, i) => createComponent2(View, {
                class: "absolute left-0",
                get style() {
                  return {
                    insetT: i * props.rowH,
                    width,
                    height: props.rowH
                  };
                },
                get children() {
                  return props.children(item, i);
                }
              })
            })];
          }
        });
      }
    });
  }

  // shell/src/deck/pins.ts
  var MAX_PINS = 6;
  var PIN = "\uDB81\uDC03";
  var UNPIN = "\uDB81\uDC04";
  var DEFAULT_PINS = ["Terminal", "Agent", "YouTube", "X", "GitHub", "Weather"];
  var [saved2, setSaved] = createSignal(null);
  request({
    method: "pins"
  }).then(setSaved, () => {});
  var pinnable = (item) => !!item && item.id.startsWith("apps.");
  function pinIds(apps) {
    const chosen = saved2() ?? DEFAULT_PINS.flatMap((label) => apps.find((a) => a.label.toLowerCase() === label.toLowerCase())?.id ?? []);
    return apps.length ? chosen.filter((id) => apps.some((a) => a.id === id)) : chosen;
  }
  function togglePin(item, apps) {
    const now = pinIds(apps);
    if (now.includes(item.id))
      return save2(now.filter((id) => id !== item.id));
    if (now.length >= MAX_PINS)
      return toast({
        icon: PIN,
        title: `Home holds ${MAX_PINS} pins`,
        body: "Unpin one to make room",
        tone: "info"
      });
    save2([...now, item.id]);
  }
  function save2(ids) {
    setSaved(ids);
    request({
      method: "pinsSet",
      ids
    }).catch(() => {});
  }

  // shell/src/generated/bluetooth-model.js
  function isAddressLike(value) {
    var text = String(value || "").trim();
    return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(text);
  }

  // shell/src/generated/network-model.js
  function wifiIconFor(strength) {
    var icons = ["\uDB82\uDD2F", "\uDB82\uDD1F", "\uDB82\uDD22", "\uDB82\uDD25", "\uDB82\uDD28"];
    var index = Math.max(0, Math.min(4, Math.ceil(strength / 20) - 1));
    return icons[index];
  }
  function connectionIcon(kind, signalStrength, connectivity) {
    var restricted = connectivity === "portal" || connectivity === "limited";
    if (kind === "wifi")
      return restricted ? "\uDB82\uDD29" : wifiIconFor(signalStrength);
    if (kind === "ethernet")
      return restricted ? "\uDB80\uDE02" : "\uDB80\uDE00";
    return "\uDB82\uDD2E";
  }
  var enterpriseConnectScript = "u=$(uuidgen); IFS= read -r pw;" + ' nmcli connection add type wifi con-name "$1" ssid "$1" connection.uuid "$u"' + " wifi-sec.key-mgmt wpa-eap 802-1x.eap peap 802-1x.phase2-auth mschapv2" + ' 802-1x.identity "$2" 802-1x.auth-timeout 8 >/dev/null' + ` && printf 'set 802-1x.password %s\\nsave\\nquit\\n' "$pw" | nmcli connection edit uuid "$u" >/dev/null` + ' && nmcli connection up uuid "$u"' + ' || { nmcli connection delete uuid "$u" >/dev/null 2>&1; false; }';

  // shell/src/generated/power-model.js
  function profileIcon(name) {
    if (name === "power-saver")
      return "\uDB80\uDF2A";
    if (name === "balanced")
      return "\uDB80\uDE9A";
    if (name === "performance")
      return "\uDB81\uDCC5";
    return "\uDB80\uDC84";
  }
  function batteryFraction(device) {
    return device && device.isPresent ? Math.max(0, Math.min(1, device.percentage)) : 0;
  }
  function chargeThresholdActive(device, onBattery, states) {
    var d = device || {};
    var s = states || {};
    if (!(d && d.isPresent && !onBattery))
      return false;
    var fraction = batteryFraction(d);
    if (d.state === s.Discharging)
      return false;
    if (d.state === s.PendingCharge)
      return true;
    if (d.state === s.FullyCharged && fraction < 0.99)
      return true;
    if (d.state !== s.Charging || fraction >= 0.99)
      return false;
    return Number(d.changeRate || 0) <= 0.2 || Number(d.timeToFull || 0) >= 8 * 60 * 60;
  }
  function batteryIcon(device, onBattery, states) {
    var d = device || {};
    if (!d.isPresent)
      return "";
    var chargingIcons = ["\uDB82\uDC9C", "\uDB80\uDC86", "\uDB80\uDC87", "\uDB80\uDC88", "\uDB82\uDC9D", "\uDB80\uDC89", "\uDB82\uDC9E", "\uDB80\uDC8A", "\uDB80\uDC8B", "\uDB80\uDC85"];
    var defaultIcons = ["\uDB80\uDC7A", "\uDB80\uDC7B", "\uDB80\uDC7C", "\uDB80\uDC7D", "\uDB80\uDC7E", "\uDB80\uDC7F", "\uDB80\uDC80", "\uDB80\uDC81", "\uDB80\uDC82", "\uDB80\uDC79"];
    var index = Math.max(0, Math.min(9, Math.floor(d.percentage * 10)));
    var threshold = chargeThresholdActive(d, onBattery, states);
    if (threshold)
      return defaultIcons[index];
    if (d.state === states.FullyCharged)
      return "\uDB80\uDC85";
    if (!onBattery)
      return chargingIcons[index];
    return defaultIcons[index];
  }

  // shell/src/indicators.ts
  var UPOWER = {
    Charging: 1,
    Discharging: 2,
    Empty: 3,
    FullyCharged: 4,
    PendingCharge: 5,
    PendingDischarge: 6
  };
  function batteryGlyph(battery) {
    if (!battery)
      return "";
    const full = battery.charging && battery.percent >= 100;
    const device = {
      isPresent: true,
      percentage: battery.percent / 100,
      state: full ? UPOWER.FullyCharged : battery.charging ? UPOWER.Charging : UPOWER.Discharging,
      changeRate: battery.charging ? 1 : 0
    };
    return batteryIcon(device, !battery.charging, UPOWER);
  }
  function networkGlyph(network) {
    if (!network || network.kind === "none")
      return connectionIcon("disconnected", -1, "none");
    return connectionIcon(network.kind, network.signal ?? 0, "full");
  }
  function audioGlyph(audio) {
    if (!audio || audio.muted)
      return "";
    const v = audio.volume / 100;
    if (v >= 0.67)
      return "";
    if (v >= 0.34)
      return "";
    if (v > 0)
      return "";
    return "";
  }
  function bluetoothGlyph(bluetooth) {
    if (!bluetooth)
      return "";
    return bluetooth.powered ? "\uDB80\uDCAF" : "\uDB80\uDCB2";
  }

  // shell/src/keys.ts
  var NO_SINK = {
    text() {},
    key() {}
  };
  var BUTTON_KEYS = [[BTN.UP, "Up"], [BTN.DOWN, "Down"], [BTN.LEFT, "Left"], [BTN.RIGHT, "Right"], [BTN.CIRCLE, "Enter"], [BTN.CROSS, "Backspace"], [BTN.TRIANGLE, "Tab"], [BTN.SQUARE, " "], [BTN.START, "Escape"]];
  var KEY_BUTTONS = Object.fromEntries(BUTTON_KEYS.map(([b, k]) => [k, b]));
  var buttonKey = (button) => BUTTON_KEYS.find(([b]) => b & button)?.[1];
  var [field, setField] = createSignal(null);
  function setFieldSink(sink) {
    setField(() => sink);
  }

  // shell/src/generated/osd-model.js
  function clamp2(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function iconFor(name, percent) {
    var n = String(name || "").toLowerCase();
    if (n === "volume-muted" || n === "volume-mute" || n === "muted" || n === "mute")
      return "";
    if (n === "volume-low")
      return "";
    if (n === "volume-medium")
      return "";
    if (n === "volume-high" || n === "volume")
      return "";
    if (n === "microphone-muted" || n === "microphone-off" || n === "mic-muted" || n === "mic-off")
      return "\uDB80\uDF6D";
    if (n === "microphone" || n === "mic")
      return "\uDB80\uDF6C";
    if (n === "keyboard")
      return "\uDB80\uDF0C";
    if (n === "brightness" || n === "display")
      return "\uDB80\uDF79";
    if (n === "touchpad")
      return "\uDB81\uDFF8";
    if (n === "touch" || n === "touchscreen")
      return "\uDB81\uDF41";
    if (n === "reboot" || n === "restart")
      return "\uDB81\uDF09";
    if (n === "shutdown" || n === "power" || n === "poweroff")
      return "\uDB81\uDC25";
    if (n === "logout" || n === "sign-out" || n === "leave")
      return "\uDB80\uDF43";
    if (n === "media" || n === "player")
      return "\uDB81\uDF5A";
    if (n === "media-source" || n === "player-source")
      return "\uDB81\uDF5A";
    if (n === "media-play" || n === "player-play")
      return "\uDB81\uDC0A";
    if (n === "media-pause" || n === "player-pause")
      return "\uDB80\uDFE4";
    if (n === "media-next" || n === "player-next")
      return "\uDB81\uDCAD";
    if (n === "media-previous" || n === "player-previous")
      return "\uDB81\uDCAE";
    if (n.length > 0)
      return name;
    if (percent <= 0)
      return "";
    if (percent <= 33)
      return "";
    if (percent <= 66)
      return "";
    return "";
  }
  function stateForShow(iconName, rawMessage, rawValue, rawMax, rawProgressText, rawDuration, fmt) {
    var number = typeof fmt === "function" ? fmt : function(v) {
      return String(v);
    };
    var maxValue = Math.max(1, parseInt(rawMax || "100", 10));
    var parsedValue = parseInt(rawValue || "0", 10);
    var hasProgress = rawValue !== "" && !isNaN(parsedValue) && rawMessage === "";
    var value = hasProgress ? clamp2(parsedValue, 0, maxValue) : 0;
    var percent = hasProgress ? Math.round(value * 100 / maxValue) : -1;
    var parsedDuration = parseInt(rawDuration || "1200", 10);
    return {
      iconKey: String(iconName || "").toLowerCase(),
      maxValue,
      hasProgress,
      value,
      message: String(rawMessage || (hasProgress ? rawProgressText || number(percent) + "%" : "")),
      icon: iconFor(iconName, percent),
      duration: isNaN(parsedDuration) ? 1200 : Math.max(0, parsedDuration)
    };
  }

  // shell/src/stage/osd.tsx
  var ADVANCE = 9.6;
  var PROGRESS_W = 240;
  var MAX_W = 400;
  var [shown3, setShown2] = createSignal(null);
  var generation2 = 0;
  function showOsd(payloadJson) {
    const p = JSON.parse(payloadJson || "{}");
    const next = stateForShow(p.icon || "", p.message || "", p.value === undefined ? "" : String(p.value), p.max === undefined ? "100" : String(p.max), p.progressText || "", p.duration === undefined ? "1200" : String(p.duration));
    setShown2(next);
    const mine = ++generation2;
    if (next.duration > 0)
      after(next.duration / 1000, () => mine === generation2 && setShown2(null));
  }
  serve("osd", {
    show: (payloadJson) => (showOsd(payloadJson), "ok"),
    close: () => (setShown2(null), "ok"),
    state: () => shown3() ? "open" : "closed",
    ping: () => "ok"
  });
  function Osd() {
    return createComponent2(Show, {
      get when() {
        return shown3();
      },
      children: (osd) => {
        const width = () => osd().hasProgress ? PROGRESS_W : Math.min(MAX_W, Math.round(48 + osd().message.length * ADVANCE + 12));
        return createComponent2(View, {
          get ["class"]() {
            return C.osd;
          },
          get style() {
            return {
              insetL: Math.round((512 - width()) / 2),
              width: width(),
              bgColor: color("background", 0.97),
              borderColor: color("accent")
            };
          },
          get children() {
            return [createComponent2(Text, {
              get ["class"]() {
                return C.osdIcon;
              },
              get style() {
                return {
                  textColor: color("foreground")
                };
              },
              get children() {
                return osd().icon;
              }
            }), createComponent2(Show, {
              get when() {
                return osd().hasProgress;
              },
              get fallback() {
                return createComponent2(Text, {
                  get ["class"]() {
                    return C.osdMessage;
                  },
                  get style() {
                    return {
                      textColor: color("foreground")
                    };
                  },
                  get children() {
                    return osd().message;
                  }
                });
              },
              get children() {
                return [createComponent2(View, {
                  get ["class"]() {
                    return C.osdTrack;
                  },
                  get style() {
                    return {
                      bgColor: color("foreground", 0.45)
                    };
                  },
                  get children() {
                    return createComponent2(View, {
                      class: "absolute left-0 top-0 h-[4]",
                      get style() {
                        return {
                          width: Math.round(120 * osd().value / osd().maxValue),
                          bgColor: color("accent")
                        };
                      }
                    });
                  }
                }), createComponent2(Text, {
                  get ["class"]() {
                    return C.osdValue;
                  },
                  get style() {
                    return {
                      textColor: color("foreground")
                    };
                  },
                  get children() {
                    return osd().message;
                  }
                })];
              }
            })];
          }
        });
      }
    });
  }

  // vendor/pocketjs/tools/companion/qr.ts
  var M_BLOCKS = [
    [0, []],
    [10, [[1, 16]]],
    [16, [[1, 28]]],
    [26, [[1, 44]]],
    [18, [[2, 32]]],
    [24, [[2, 43]]],
    [16, [[4, 27]]],
    [18, [[4, 31]]],
    [22, [[2, 38], [2, 39]]],
    [22, [[3, 36], [2, 37]]],
    [26, [[4, 43], [1, 44]]]
  ];
  var ALIGNMENT = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  var QR_MAX_VERSION = 10;
  function dataCodewords(version) {
    return M_BLOCKS[version][1].reduce((n, [blocks, per]) => n + blocks * per, 0);
  }
  function byteCapacity(version) {
    const countBits = version <= 9 ? 8 : 16;
    return Math.floor((dataCodewords(version) * 8 - 4 - countBits) / 8);
  }
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7;i >= 0; i--) {
      z = z << 1 ^ (z >>> 7) * 285;
      z ^= (y >>> i & 1) * x;
    }
    return z & 255;
  }
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0;i < degree; i++) {
      for (let j = 0;j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length)
          result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => result[i] ^= gfMul(coef, factor));
    }
    return result;
  }
  function encodeCodewords(bytes, version) {
    const bits = [];
    const push = (value, length) => {
      for (let i = length - 1;i >= 0; i--)
        bits.push(value >>> i & 1);
    };
    push(4, 4);
    push(bytes.length, version <= 9 ? 8 : 16);
    for (const b of bytes)
      push(b, 8);
    const capacityBits = dataCodewords(version) * 8;
    push(0, Math.min(4, capacityBits - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    const data = [];
    for (let i = 0;i < bits.length; i += 8)
      data.push(bits.slice(i, i + 8).reduce((n, bit) => n << 1 | bit, 0));
    for (let pad = 236;data.length < dataCodewords(version); pad ^= 236 ^ 17)
      data.push(pad);
    const [ecLen, groups] = M_BLOCKS[version];
    const divisor = rsDivisor(ecLen);
    const blocks = [];
    let off = 0;
    for (const [count, per] of groups) {
      for (let b = 0;b < count; b++) {
        const chunk = data.slice(off, off + per);
        off += per;
        blocks.push({
          data: chunk,
          ec: rsRemainder(chunk, divisor)
        });
      }
    }
    const out = [];
    const maxData = Math.max(...blocks.map((b) => b.data.length));
    for (let i = 0;i < maxData; i++)
      for (const block of blocks)
        if (i < block.data.length)
          out.push(block.data[i]);
    for (let i = 0;i < ecLen; i++)
      for (const block of blocks)
        out.push(block.ec[i]);
    return out;
  }

  class Matrix {
    constructor(size) {
      this.size = size;
      this.modules = Array.from({
        length: size
      }, () => new Array(size).fill(false));
      this.isFunction = Array.from({
        length: size
      }, () => new Array(size).fill(false));
    }
    set(x, y, dark) {
      this.modules[y][x] = dark;
      this.isFunction[y][x] = true;
    }
  }
  function formatBits(mask) {
    const data = 0 << 3 | mask;
    let rem = data;
    for (let i = 0;i < 10; i++)
      rem = rem << 1 ^ (rem >>> 9) * 1335;
    return (data << 10 | rem) ^ 21522;
  }
  function versionBits(version) {
    let rem = version;
    for (let i = 0;i < 12; i++)
      rem = rem << 1 ^ (rem >>> 11) * 7973;
    return version << 12 | rem;
  }
  function drawFormat(m, mask) {
    const bits = formatBits(mask);
    const bit = (i) => (bits >>> i & 1) === 1;
    for (let i = 0;i <= 5; i++)
      m.set(8, i, bit(i));
    m.set(8, 7, bit(6));
    m.set(8, 8, bit(7));
    m.set(7, 8, bit(8));
    for (let i = 9;i < 15; i++)
      m.set(14 - i, 8, bit(i));
    for (let i = 0;i < 8; i++)
      m.set(m.size - 1 - i, 8, bit(i));
    for (let i = 8;i < 15; i++)
      m.set(8, m.size - 15 + i, bit(i));
    m.set(8, m.size - 8, true);
  }
  function drawFunctionPatterns(m, version) {
    const {
      size
    } = m;
    for (let i = 0;i < size; i++) {
      m.set(6, i, i % 2 === 0);
      m.set(i, 6, i % 2 === 0);
    }
    const finder = (cx, cy) => {
      for (let dy = -4;dy <= 4; dy++) {
        for (let dx = -4;dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size)
            continue;
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          m.set(x, y, dist !== 2 && dist !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    const positions = ALIGNMENT[version];
    const last = positions.length - 1;
    positions.forEach((py, i) => positions.forEach((px, j) => {
      if (i === 0 && j === 0 || i === 0 && j === last || i === last && j === 0)
        return;
      for (let dy = -2;dy <= 2; dy++)
        for (let dx = -2;dx <= 2; dx++)
          m.set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    drawFormat(m, 0);
    if (version >= 7) {
      const bits = versionBits(version);
      for (let i = 0;i < 18; i++) {
        const dark = (bits >>> i & 1) === 1;
        const a = size - 11 + i % 3;
        const b = Math.floor(i / 3);
        m.set(a, b, dark);
        m.set(b, a, dark);
      }
    }
  }
  function drawCodewords(m, codewords) {
    let i = 0;
    const total = codewords.length * 8;
    for (let right = m.size - 1;right >= 1; right -= 2) {
      if (right === 6)
        right = 5;
      const upward = (right + 1 & 2) === 0;
      for (let vert = 0;vert < m.size; vert++) {
        for (let j = 0;j < 2; j++) {
          const x = right - j;
          const y = upward ? m.size - 1 - vert : vert;
          if (m.isFunction[y][x])
            continue;
          if (i < total)
            m.modules[y][x] = (codewords[i >>> 3] >>> 7 - (i & 7) & 1) === 1;
          i++;
        }
      }
    }
  }
  function maskBit(mask, x, y) {
    switch (mask) {
      case 0:
        return (x + y) % 2 === 0;
      case 1:
        return y % 2 === 0;
      case 2:
        return x % 3 === 0;
      case 3:
        return (x + y) % 3 === 0;
      case 4:
        return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5:
        return x * y % 2 + x * y % 3 === 0;
      case 6:
        return (x * y % 2 + x * y % 3) % 2 === 0;
      case 7:
        return ((x + y) % 2 + x * y % 3) % 2 === 0;
      default:
        throw new Error(`mask ${mask}`);
    }
  }
  function applyMask(m, mask) {
    for (let y = 0;y < m.size; y++) {
      for (let x = 0;x < m.size; x++) {
        if (!m.isFunction[y][x] && maskBit(mask, x, y))
          m.modules[y][x] = !m.modules[y][x];
      }
    }
  }
  var FINDER_LIKE = [[true, false, true, true, true, false, true, false, false, false, false], [false, false, false, false, true, false, true, true, true, false, true]];
  function penalty(modules) {
    const size = modules.length;
    let score = 0;
    const line = (get) => {
      let run = 1;
      for (let i = 1;i <= size; i++) {
        if (i < size && get(i) === get(i - 1))
          run++;
        else {
          if (run >= 5)
            score += 3 + (run - 5);
          run = 1;
        }
      }
      for (let i = 0;i + 11 <= size; i++) {
        for (const pattern of FINDER_LIKE)
          if (pattern.every((dark, k) => get(i + k) === dark))
            score += 40;
      }
    };
    for (let y = 0;y < size; y++)
      line((x) => modules[y][x]);
    for (let x = 0;x < size; x++)
      line((y) => modules[y][x]);
    for (let y = 0;y + 1 < size; y++) {
      for (let x = 0;x + 1 < size; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1])
          score += 3;
      }
    }
    let dark = 0;
    for (const row of modules)
      for (const cell of row)
        if (cell)
          dark++;
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
  function encodeQr(text, options = {}) {
    const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
    let version = Math.max(1, options.minVersion ?? 1);
    while (version <= QR_MAX_VERSION && byteCapacity(version) < bytes.length)
      version++;
    if (version > QR_MAX_VERSION)
      throw new Error(`QR: ${bytes.length} bytes exceed version ${QR_MAX_VERSION}-M (${byteCapacity(QR_MAX_VERSION)} bytes)`);
    const size = 17 + 4 * version;
    const base = new Matrix(size);
    drawFunctionPatterns(base, version);
    drawCodewords(base, encodeCodewords(bytes, version));
    let best;
    const masks = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
    for (const mask of masks) {
      const m = new Matrix(size);
      for (let y = 0;y < size; y++) {
        m.modules[y] = [...base.modules[y]];
        m.isFunction[y] = [...base.isFunction[y]];
      }
      applyMask(m, mask);
      drawFormat(m, mask);
      const score = penalty(m.modules);
      if (!best || score < best.score)
        best = {
          mask,
          modules: m.modules,
          score
        };
    }
    return {
      version,
      size,
      mask: best.mask,
      modules: best.modules
    };
  }

  // shell/src/stage/qrsheet.tsx
  var [sheet, setSheet] = createSignal(null);
  var qrOpen = () => sheet() !== null;
  var closeQr = () => setSheet(null);
  var showQr = (title, url) => setSheet({
    title,
    url
  });
  var BOX2 = 260;
  var QUIET = 2;
  function runsOf(modules) {
    const out = [];
    modules.forEach((row, y) => {
      let start = -1;
      row.forEach((dark, x) => {
        if (dark && start < 0)
          start = x;
        if (!dark && start >= 0) {
          out.push({
            x: start,
            y,
            w: x - start
          });
          start = -1;
        }
      });
      if (start >= 0)
        out.push({
          x: start,
          y,
          w: row.length - start
        });
    });
    return out;
  }
  function QrSheet() {
    const code = createMemo(() => {
      const s = sheet();
      if (!s)
        return null;
      try {
        const qr = encodeQr(Uint8Array.from(s.url, (c) => c.charCodeAt(0) & 255));
        const cell = Math.max(2, Math.floor(BOX2 / (qr.size + 2 * QUIET)));
        return {
          runs: runsOf(qr.modules),
          size: qr.size,
          cell,
          side: cell * (qr.size + 2 * QUIET)
        };
      } catch {
        return null;
      }
    });
    return createComponent2(Show, {
      get when() {
        return sheet();
      },
      children: (s) => createComponent2(View, {
        class: "absolute left-[12] top-[24] w-[488] h-[348] rounded-md border-[1]",
        get style() {
          return {
            bgColor: color("background", 0.96),
            borderColor: color("accent")
          };
        },
        ref: (node) => {
          jump(node, "opacity", 0);
          animate(node, "opacity", 1, {
            dur: 150,
            easing: "out"
          });
        },
        get children() {
          return [createComponent2(Text, {
            class: "absolute left-[12] top-[8] font-mono text-sm leading-[16]",
            get style() {
              return {
                textColor: color("bright_foreground")
              };
            },
            get children() {
              return s().title;
            }
          }), createComponent2(Text, {
            class: "absolute right-[12] top-[9] font-mono text-xs leading-[14]",
            get style() {
              return {
                textColor: color("dark_foreground")
              };
            },
            children: "any button closes"
          }), createComponent2(View, {
            class: "absolute left-[12] top-[30] w-[464] h-[1]",
            get style() {
              return {
                bgColor: color("muted")
              };
            }
          }), createComponent2(Show, {
            get when() {
              return code();
            },
            children: (q) => createComponent2(View, {
              class: "absolute bg-white",
              get style() {
                return {
                  insetL: (488 - q().side) / 2,
                  insetT: 40,
                  width: q().side,
                  height: q().side
                };
              },
              get children() {
                return createComponent2(For, {
                  get each() {
                    return q().runs;
                  },
                  children: (run) => createComponent2(View, {
                    class: "absolute bg-black",
                    get style() {
                      return {
                        insetL: (run.x + QUIET) * q().cell,
                        insetT: (run.y + QUIET) * q().cell,
                        width: run.w * q().cell,
                        height: q().cell
                      };
                    }
                  })
                });
              }
            })
          }), createComponent2(Show, {
            get when() {
              return !code();
            },
            get children() {
              return createComponent2(Text, {
                class: "absolute left-[12] top-[60] font-mono text-xs leading-[14]",
                get style() {
                  return {
                    textColor: color("foreground")
                  };
                },
                children: "The link is too long for a code; type it instead."
              });
            }
          }), createComponent2(Text, {
            class: "absolute left-[12] h-[14] overflow-hidden font-mono text-xs leading-[14] text-center",
            get style() {
              return {
                insetT: 348 - 26,
                width: 464,
                textColor: color("foreground")
              };
            },
            get children() {
              return s().url;
            }
          })];
        }
      })
    });
  }

  // shell/src/stage/panels.tsx
  var PANELS = ["tailscale", "proxy", "bluetooth", "network", "audio", "power"];
  var TITLES = {
    tailscale: "Tailscale",
    proxy: "Proxy",
    bluetooth: "Bluetooth",
    network: "Network",
    audio: "Audio",
    power: "Power"
  };
  var PROXY_MODES = ["rule", "global", "direct"];
  var nodeName = (name) => name.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();
  var HEADER_H = 26;
  var ROW_H3 = 22;
  var ROWS = Math.floor((CARD_H - HEADER_H - 4) / ROW_H3);
  var REFRESH_EVERY = 4;
  var ERROR3 = "\uDB80\uDD5A";
  var CHECK = "\uDB80\uDD2C";
  var LOCK = "\uDB80\uDF3E";
  var LAN = "\uDB80\uDF18";
  var KEY = "\uDB80\uDF06";
  var LOGOUT = "\uDB80\uDF43";
  var ONLINE = "\uDB81\uDF65";
  var OFFLINE = "\uDB81\uDF66";
  var STEP = 5;
  var [panel, setPanel] = createSignal(null);
  var [selected4, setSelected4] = createSignal("");
  var seen = new Map;
  var [network, setNetwork] = createSignal(null);
  var [audio, setAudio] = createSignal(null);
  var [power, setPower] = createSignal(null);
  var [proxy, setProxy] = createSignal(null);
  var [tailscale, setTailscale] = createSignal(null);
  var [bluetooth, setBluetooth] = createSignal(null);
  var [entry, setEntry] = createSignal(null);
  var [busy, setBusy] = createSignal("");
  var [profileAsked, setProfileAsked] = createSignal(null);
  var refreshing = 0;
  var fail3 = (title) => (error) => toast({
    icon: ERROR3,
    title,
    body: String(error).replace(/^Error: /, ""),
    tone: "error"
  });
  function load3(name, rescan = false) {
    if (name === "bluetooth")
      return request({
        method: "bluetooth"
      }).then(setBluetooth, fail3("Bluetooth"));
    if (name === "network")
      return request({
        method: "network",
        rescan
      }).then(setNetwork, fail3("Network"));
    if (name === "audio")
      return request({
        method: "audio"
      }).then(setAudio, fail3("Audio"));
    if (name === "power")
      return request({
        method: "power"
      }).then(setPower, fail3("Power"));
    if (name === "tailscale")
      return request({
        method: "tailscale"
      }).then(setTailscale, fail3("Tailscale"));
    return request({
      method: "proxy"
    }).then(setProxy, fail3("Proxy"));
  }
  function poll2(token) {
    after(REFRESH_EVERY, () => {
      const name = panel();
      if (token !== refreshing || !name)
        return;
      if (!entry() && !busy() && !sliding.size)
        load3(name);
      poll2(token);
    });
  }
  function showPanel(name) {
    setPanel(name);
    setSelected4("");
    seen = new Map;
    list2.reset();
    load3(name, name === "network");
    poll2(++refreshing);
  }
  function closePanel() {
    setPanel(null);
    refreshing++;
    endEntry();
  }
  function change(label, work, title) {
    setBusy(label);
    work.then(() => {
      setBusy("");
      const name = panel();
      if (name)
        load3(name);
    }, (error) => {
      setBusy("");
      fail3(title)(error);
    });
  }
  var [asked2, setAsked] = createSignal({});
  var sliding = new Map;
  function slide(id, value, send, title, osd) {
    setAsked((a) => ({
      ...a,
      [id]: value
    }));
    showOsd(JSON.stringify({
      icon: osd.icon,
      value,
      max: osd.max ?? 100,
      progressText: `${Math.round(value)}%`
    }));
    const s = sliding.get(id) ?? {
      inFlight: false,
      next: null,
      send,
      title
    };
    s.send = send;
    sliding.set(id, s);
    if (s.inFlight) {
      s.next = value;
      return;
    }
    const go = (v) => {
      s.inFlight = true;
      s.send(v).then(() => settled(), (error) => {
        fail3(title)(error);
        settled();
      });
    };
    const settled = () => {
      s.inFlight = false;
      if (s.next !== null) {
        const v = s.next;
        s.next = null;
        return go(v);
      }
      sliding.delete(id);
      const name = panel();
      const done = () => {
        if (!sliding.has(id))
          setAsked(({
            [id]: _,
            ...rest
          }) => rest);
      };
      if (name)
        load3(name).then(done, done);
      else
        done();
    };
    go(value);
  }
  function connect(ssid, password) {
    change(`Connecting to ${ssid}`, request({
      method: "wifiConnect",
      ssid,
      password
    }), ssid);
  }
  var entrySink = null;
  function askPassword(ssid) {
    setEntry({
      ssid,
      text: ""
    });
    entrySink = {
      text: (ch) => setEntry((e) => e && {
        ...e,
        text: e.text + ch
      }),
      key: (name) => {
        const e = entry();
        if (!e)
          return;
        if (name === "Backspace")
          setEntry({
            ...e,
            text: [...e.text].slice(0, -1).join("")
          });
        else if (name === "Enter") {
          endEntry();
          connect(e.ssid, e.text);
        } else if (name === "Escape")
          endEntry();
      },
      field: () => {
        const e = entry();
        return e ? `${LOCK} ${e.ssid}: ${"•".repeat([...e.text].length)}_` : "";
      },
      hint: () => "A connects · B Backspace · START cancels"
    };
    setFieldSink(entrySink);
  }
  function endEntry() {
    if (!entry())
      return;
    setEntry(null);
    if (field() === entrySink)
      setFieldSink(null);
    entrySink = null;
  }
  function deviceRows(kind, list, title, icon) {
    const current = list.find((d) => d.current);
    const rows = [];
    if (current) {
      const id = `${kind}:${current.name}`;
      const level = () => asked2()[id] ?? current.volume;
      rows.push({
        icon,
        label: title,
        value: current.muted ? "Muted" : `${Math.round(level())}%`,
        activate: () => change("", request({
          method: "audioSet",
          kind,
          name: current.name,
          muted: !current.muted
        }), title),
        adjust: (delta) => slide(id, Math.max(0, Math.min(150, level() + delta * STEP)), (volume) => request({
          method: "audioSet",
          kind,
          name: current.name,
          volume
        }), title, {
          icon: kind === "sink" ? "\uDB81\uDD7E" : "\uDB80\uDF6C",
          max: 150
        })
      });
    }
    for (const d of list) {
      rows.push({
        icon: "",
        label: d.label,
        checked: d.current,
        activate: () => change("", request({
          method: "audioSet",
          kind,
          name: d.name,
          current: true
        }), title)
      });
    }
    return rows;
  }
  var rawRows = createMemo(() => {
    switch (panel()) {
      case "bluetooth": {
        const b = bluetooth();
        if (!b)
          return [{
            icon: "",
            label: "Reading Bluetooth...",
            info: true
          }];
        if (!b.adapter)
          return [{
            icon: "\uDB80\uDCB2",
            label: "No Bluetooth adapter",
            info: true
          }];
        const list = [{
          icon: b.powered ? "\uDB80\uDCAF" : "\uDB80\uDCB2",
          label: "Bluetooth",
          value: b.powered ? "On" : "Off",
          activate: () => change("", request({
            method: "bluetoothPower",
            on: !b.powered
          }), "Bluetooth")
        }];
        if (!b.powered)
          return list;
        list.push({
          icon: "\uDB81\uDC50",
          label: "Scan",
          activate: () => change("Scanning for 8 s", request({
            method: "bluetooth",
            scan: true
          }).then(setBluetooth), "Bluetooth")
        });
        for (const d of b.devices.filter((d) => d.paired || d.connected || !isAddressLike(d.name))) {
          list.push({
            icon: d.connected ? "\uDB80\uDCB1" : "\uDB80\uDCAF",
            label: d.name,
            value: d.connected ? "Connected" : d.paired ? "Paired" : "",
            activate: () => d.connected ? change("", request({
              method: "bluetoothDisconnect",
              mac: d.mac
            }), d.name) : change(`Connecting to ${d.name}`, request({
              method: "bluetoothConnect",
              mac: d.mac
            }), d.name),
            forget: d.paired ? () => change("", request({
              method: "bluetoothForget",
              mac: d.mac
            }), d.name) : undefined
          });
        }
        return list;
      }
      case "network": {
        const n = network();
        if (!n)
          return [{
            icon: "",
            label: "Reading networks...",
            info: true
          }];
        const list = [{
          icon: n.enabled ? "\uDB81\uDDA9" : "\uDB81\uDDAA",
          label: "Wi-Fi",
          value: n.enabled ? "On" : "Off",
          activate: () => change("", request({
            method: "wifiPower",
            on: !n.enabled
          }), "Wi-Fi")
        }];
        const active = n.networks.find((w) => w.active);
        if (active) {
          list.push({
            icon: "",
            label: `Disconnect ${active.ssid}`,
            value: n.address,
            activate: () => change("", request({
              method: "wifiDisconnect"
            }), "Wi-Fi")
          });
        }
        if (n.enabled)
          list.push({
            icon: "\uDB81\uDC50",
            label: "Scan",
            activate: () => request({
              method: "network",
              rescan: true
            }).then(setNetwork, fail3("Network"))
          });
        for (const w of n.networks) {
          list.push({
            icon: wifiIconFor(w.signal),
            label: w.secure ? `${w.ssid} ${LOCK}` : w.ssid,
            value: w.active ? "Connected" : w.known ? "Saved" : `${w.signal}%`,
            checked: w.active,
            activate: () => w.active ? undefined : w.secure && !w.known ? askPassword(w.ssid) : connect(w.ssid),
            forget: w.known ? () => change("", request({
              method: "wifiForget",
              ssid: w.ssid
            }), w.ssid) : undefined
          });
        }
        return list;
      }
      case "audio": {
        const a = audio();
        if (!a)
          return [{
            icon: "",
            label: "Reading audio devices...",
            info: true
          }];
        return [...deviceRows("sink", a.outputs, "Output", "\uDB81\uDD7E"), ...deviceRows("source", a.inputs, "Input", "\uDB80\uDF6C")];
      }
      case "power": {
        const p = power();
        const battery = state()?.battery;
        const list = [{
          icon: batteryGlyph(battery ?? null),
          label: "Battery",
          value: battery ? `${battery.percent}%${battery.charging ? " charging" : ""}` : "none",
          info: true
        }];
        if (!p)
          return list;
        if (p.brightness !== null) {
          const level = () => asked2()["brightness"] ?? p.brightness;
          list.push({
            icon: "\uDB80\uDCDF",
            label: "Brightness",
            value: `${Math.round(level())}%`,
            adjust: (delta) => slide("brightness", Math.max(5, Math.min(100, level() + delta * STEP)), (brightness) => request({
              method: "powerSet",
              brightness
            }), "Brightness", {
              icon: "\uDB80\uDCDF"
            })
          });
        }
        const chosen = profileAsked() ?? p.profile;
        for (const profile of p.profiles) {
          list.push({
            icon: profileIcon(profile),
            label: profile,
            checked: profile === chosen,
            activate: () => {
              setProfileAsked(profile);
              change("", request({
                method: "powerSet",
                profile
              }).finally(() => setProfileAsked(null)), "Power profile");
            }
          });
        }
        return list;
      }
      case "tailscale": {
        const t = tailscale();
        if (!t)
          return [{
            icon: "",
            label: "Asking tailscaled...",
            info: true
          }];
        if (!t.installed)
          return [{
            icon: ERROR3,
            label: "tailscale is not installed",
            info: true
          }];
        const list = [{
          icon: LAN,
          label: "Tailscale",
          value: t.running ? "On" : "Off",
          checked: t.running,
          activate: () => change(t.running ? "Stopping tailscaled" : "Starting tailscaled", request({
            method: "tailscaleSet",
            running: !t.running
          }), "Tailscale")
        }];
        if (!t.running)
          return list;
        if (t.state === "NeedsLogin") {
          list.push({
            icon: KEY,
            label: "Log in",
            value: t.authUrl ? "Show the code" : "",
            activate: () => {
              if (!t.authUrl)
                return change("Asking Tailscale for a login link", request({
                  method: "tailscaleSet",
                  up: true
                }), "Tailscale");
              closePanel();
              showQr("Log in to Tailscale", t.authUrl);
            }
          });
          return list;
        }
        const up = t.state === "Running";
        list.push({
          icon: up ? CHECK : "",
          label: "Connected",
          value: up ? t.self?.ip || "Up" : t.state === "Stopped" ? "Down" : t.state,
          checked: up,
          activate: () => change(up ? "Disconnecting" : "Connecting", request({
            method: "tailscaleSet",
            up: !up
          }), "Tailscale")
        });
        if (t.self?.dns)
          list.push({
            icon: "",
            label: "Name",
            value: t.self.dns,
            info: true
          });
        if (t.tailnet)
          list.push({
            icon: "",
            label: "Tailnet",
            value: t.tailnet,
            info: true
          });
        for (const peer of t.peers)
          list.push({
            icon: peer.online ? ONLINE : OFFLINE,
            label: peer.name,
            value: peer.ip,
            info: true
          });
        list.push({
          icon: LOGOUT,
          label: "Log out",
          activate: () => change("Logging out", request({
            method: "tailscaleSet",
            logout: true
          }), "Tailscale")
        });
        return list;
      }
      case "proxy": {
        const p = proxy();
        if (!p)
          return [{
            icon: "",
            label: "Asking mihomo...",
            info: true
          }];
        if (!p.installed)
          return [{
            icon: ERROR3,
            label: "mihomo is not installed",
            info: true
          }];
        const list = [{
          icon: "\uDB81\uDD82",
          label: "Proxy",
          value: p.running ? "On" : "Off",
          checked: p.running,
          activate: () => change(p.running ? "Stopping mihomo" : "Starting mihomo", request({
            method: "proxySet",
            running: !p.running
          }), "Proxy")
        }];
        if (!p.running)
          return list;
        const at = Math.max(0, PROXY_MODES.indexOf(p.mode));
        const mode = (delta) => change("", request({
          method: "proxySet",
          mode: PROXY_MODES[(at + delta + PROXY_MODES.length) % PROXY_MODES.length]
        }), "Proxy mode");
        list.push({
          icon: "\uDB80\uDDE7",
          label: "Mode",
          value: p.mode.charAt(0).toUpperCase() + p.mode.slice(1),
          activate: () => mode(1),
          adjust: mode
        });
        for (const g of p.groups) {
          const i = Math.max(0, g.all.indexOf(g.now));
          list.push({
            icon: "\uDB82\uDF8A",
            label: nodeName(g.name),
            value: `${nodeName(g.now)}${g.delay ? ` ${g.delay} ms` : ""}`,
            activate: () => change(`Testing ${nodeName(g.name)}`, request({
              method: "proxySet",
              test: g.name
            }), g.name),
            adjust: (delta) => change("", request({
              method: "proxySet",
              group: g.name,
              node: g.all[(i + delta + g.all.length) % g.all.length]
            }), g.name)
          });
        }
        return list;
      }
      default:
        return [];
    }
  });
  var rows = createMemo(() => {
    const list = rawRows();
    for (const row of list)
      if (!seen.has(row.label))
        seen.set(row.label, seen.size);
    return [...list].sort((a, b) => seen.get(a.label) - seen.get(b.label));
  });
  var index = () => Math.max(0, rows().findIndex((row) => row.label === selected4()));
  var list2 = createList(ROW_H3, HEADER_H, ROWS);
  function setIndex(at) {
    const all = rows();
    const i = Math.max(0, Math.min(all.length - 1, at));
    const row = all[i];
    if (!row)
      return;
    setSelected4(row.label);
    list2.reveal(i, all.length);
  }
  function move(delta) {
    setIndex(index() + delta);
  }
  function panelKey(name) {
    const row = rows()[Math.min(index(), rows().length - 1)];
    switch (name) {
      case "Up":
        return move(-1);
      case "Down":
        return move(1);
      case "Left":
        return row?.adjust?.(-1);
      case "Right":
        return row?.adjust?.(1);
      case "Enter":
        return row?.activate?.();
      case "Forget":
        return row?.forget?.();
      case "Escape":
      case "Backspace":
        return closePanel();
    }
  }
  function panelTouch(frame) {
    for (const tap of frame.taps)
      if (!tap.moved && tap.y < HEADER_H)
        return closePanel();
    list2.touch(frame, rows().length, (at) => {
      if (at === index())
        rows()[at]?.activate?.();
      else
        setIndex(at);
    });
  }
  function Panels() {
    return createComponent2(View, {
      get ["class"]() {
        return C.card;
      },
      get style() {
        return {
          bgColor: color("darker_background")
        };
      },
      get children() {
        return [createComponent2(Text, {
          get ["class"]() {
            return C.crumbs;
          },
          get style() {
            return {
              textColor: color("accent")
            };
          },
          get children() {
            return TITLES[panel() ?? "network"];
          }
        }), createComponent2(Text, {
          class: "absolute right-[12] top-[6] font-mono text-xs leading-[16]",
          get style() {
            return {
              textColor: color(busy() ? "accent" : "dark_foreground")
            };
          },
          get children() {
            return busy();
          }
        }), createComponent2(View, {
          get ["class"]() {
            return C.cardRule;
          },
          get style() {
            return {
              bgColor: color("muted")
            };
          }
        }), createComponent2(List, {
          state: list2,
          items: rows,
          top: HEADER_H,
          rowH: ROW_H3,
          width: CARD_W - 16,
          selected: index,
          children: (row, at) => [createComponent2(Text, {
            get ["class"]() {
              return C.icon;
            },
            get style() {
              return {
                textColor: color(at === index() ? "accent" : "dark_foreground")
              };
            },
            get children() {
              return row().icon;
            }
          }), createComponent2(Text, {
            get ["class"]() {
              return C.label;
            },
            get style() {
              return {
                textColor: color(row().info ? "dark_foreground" : at === index() ? "bright_foreground" : "foreground"),
                ...cjk(row().label, CJK_SLOT_14)
              };
            },
            get children() {
              return row().label;
            }
          }), createComponent2(Show, {
            get when() {
              return row().value !== undefined || row().checked;
            },
            get children() {
              return createComponent2(Text, {
                get ["class"]() {
                  return C.chevron;
                },
                get style() {
                  return {
                    textColor: color(row().checked ? "accent" : "foreground"),
                    ...cjk(row().value ?? "", CJK_SLOT_14)
                  };
                },
                get children() {
                  return memo2(() => !!(row().checked && row().value === undefined))() ? CHECK : row().value ?? "";
                }
              });
            }
          })]
        })];
      }
    });
  }

  // shell/src/generated/image-picker-model.js
  function nameForPath(path) {
    return String(path || "").split("/").pop().replace(/\.[^/.]+$/, "");
  }
  function labelForPath(path) {
    return nameForPath(path).replace(/[-_]+/g, " ").replace(/\b\w/g, function(match) {
      return match.toUpperCase();
    });
  }
  function loadRows(rows) {
    var images = [];
    var seen = {};
    var paths = String(rows || "").split(`
`);
    for (var i = 0;i < paths.length; i++) {
      var row = paths[i];
      if (!row)
        continue;
      var columns = row.split("\t");
      var path = columns[0];
      if (!path)
        continue;
      var fileName = path.split("/").pop();
      if (seen[fileName])
        continue;
      seen[fileName] = true;
      images.push({
        filePath: path,
        fileName,
        thumbnailPath: columns[1] || path
      });
    }
    return images;
  }

  // shell/src/stage/wallpaper.tsx
  var nodes3 = [];
  var handles2 = [];
  var loading = 0;
  async function load4(path) {
    const mine = ++loading;
    let tiles;
    try {
      tiles = await request({
        method: "wallpaper",
        path
      });
    } catch (error) {
      toast({
        icon: "\uDB80\uDD5A",
        title: "Background",
        body: String(error),
        tone: "error"
      });
      return;
    }
    if (mine !== loading)
      return;
    const bridge = globalThis.omarchyBridge;
    const next = tiles.map((t) => bridge?.loadTexture(t.file, t.w, t.h) ?? -1);
    const ops = getOps();
    if (next.some((h) => h < 0) || nodes3.some((n) => !n)) {
      for (const h of next)
        if (h >= 0)
          ops.freeTexture?.(h);
      return;
    }
    next.forEach((handle, i) => ops.setImage(nodes3[i].id, handle));
    for (const h of handles2)
      ops.freeTexture?.(h);
    handles2 = next;
  }
  var previewWallpaper = (path) => void load4(path);
  var restoreWallpaper = () => void load4();
  var set = (path) => (void load4(path), "ok");
  serve("background", {
    set,
    setInstant: set,
    refresh: () => set(),
    transition: (_from, path) => set(path),
    themeTransition: (_from, _path, finalPath) => set(finalPath),
    prepare: () => "ok",
    setSuspended: () => "ok"
  });
  load4();
  function Wallpaper() {
    return [createComponent2(Image, {
      ref: (n) => nodes3[0] = n,
      class: "absolute left-0 top-0 w-[256] h-[256]",
      src: "wall-0-0.png"
    }), createComponent2(Image, {
      ref: (n) => nodes3[1] = n,
      class: "absolute left-[256] top-0 w-[256] h-[256]",
      src: "wall-1-0.png"
    }), createComponent2(Image, {
      ref: (n) => nodes3[2] = n,
      class: "absolute left-0 top-[256] w-[256] h-[128]",
      src: "wall-0-1.png"
    }), createComponent2(Image, {
      ref: (n) => nodes3[3] = n,
      class: "absolute left-[256] top-[256] w-[256] h-[128]",
      src: "wall-1-1.png"
    })];
  }

  // shell/src/stage/picker.tsx
  var HEADER_H2 = 26;
  var ROW_H4 = 22;
  var ROWS2 = Math.floor((CARD_H - HEADER_H2 - 4) / ROW_H4);
  var PREVIEW_AFTER = 0.25;
  var ERROR4 = "\uDB80\uDD5A";
  var [mode, setMode] = createSignal(null);
  var [rows2, setRows] = createSignal([]);
  var [index2, setIndex2] = createSignal(0);
  var picker = createList(ROW_H4, HEADER_H2, ROWS2);
  var previewToken = 0;
  var pickerOpen = () => mode() !== null;
  var quote2 = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  function show2(next, rowsText, selected) {
    const list = loadRows(rowsText);
    if (!list.length) {
      toast({
        icon: ERROR4,
        title: "Images",
        body: "Nothing to pick from",
        tone: "error"
      });
      if (next.kind === "select")
        run(`: > ${quote2(next.doneFile)}`);
      return;
    }
    const at = Math.max(0, list.findIndex((r) => r.filePath === selected || r.thumbnailPath === selected));
    setRows(list);
    setMode(next);
    picker.reset();
    select4(at);
  }
  function select4(at) {
    const list = rows2();
    const i = Math.max(0, Math.min(list.length - 1, at));
    setIndex2(i);
    picker.reveal(i, list.length);
    const token = ++previewToken;
    after(PREVIEW_AFTER, () => token === previewToken && previewWallpaper(list[i].thumbnailPath));
  }
  function close(apply) {
    const m = mode();
    const row = rows2()[index2()];
    setMode(null);
    previewToken++;
    if (!m)
      return;
    if (m.kind === "themes") {
      if (apply && row) {
        const name = nameForPath(row.filePath);
        toast({
          icon: "\uDB83\uDD7D",
          title: `Applying ${name}`,
          body: "the colours follow in a moment",
          tone: "info"
        }, 3);
        run(`omarchy-theme-set ${quote2(name)}`);
      } else
        restoreWallpaper();
      return;
    }
    const write = apply && row ? `printf '%s\\n' ${quote2(row.filePath)} > ${quote2(m.selectionFile)}; ` : "";
    run(`${write}: > ${quote2(m.doneFile)}`);
    if (!apply)
      restoreWallpaper();
  }
  function openThemePicker() {
    run("omarchy-theme-switcher --print-rows").then((result) => run("cat ~/.local/state/omarchy/current/theme.name").then((name) => {
      const current = name.stdout.trim();
      const selected = loadRows(result.stdout).find((r) => nameForPath(r.filePath) === current)?.filePath ?? "";
      show2({
        kind: "themes"
      }, result.stdout, selected);
    }), () => {});
  }
  serve("image-selector", {
    open: (_dirs, rowsB64, selected, selectionFile, doneFile) => {
      show2({
        kind: "select",
        selectionFile: selectionFile ?? "",
        doneFile: doneFile ?? ""
      }, decode(rowsB64 ?? ""), selected ?? "");
      return "ok";
    },
    preload: () => "ok",
    cancel: () => (close(false), "ok"),
    ping: () => "ok"
  });
  function decode(b64) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes = [];
    let bits = 0;
    let value = 0;
    for (const c of b64) {
      const digit = alphabet.indexOf(c);
      if (digit < 0)
        continue;
      value = value << 6 | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push(value >> bits & 255);
      }
    }
    let out = "";
    for (let i = 0;i < bytes.length; ) {
      const b = bytes[i];
      const n = b < 128 ? 1 : b < 224 ? 2 : b < 240 ? 3 : 4;
      let cp = n === 1 ? b : b & 255 >> n + 1;
      for (let k = 1;k < n; k++)
        cp = cp << 6 | bytes[i + k] & 63;
      out += String.fromCodePoint(cp);
      i += n;
    }
    return out;
  }
  function pickerKey(name) {
    switch (name) {
      case "Up":
        return select4(index2() - 1);
      case "Down":
        return select4(index2() + 1);
      case "PageUp":
        return select4(index2() - ROWS2);
      case "PageDown":
        return select4(index2() + ROWS2);
      case "Enter":
        return close(true);
      case "Escape":
      case "Backspace":
        return close(false);
    }
  }
  function pickerTouch(frame) {
    for (const tap of frame.taps)
      if (!tap.moved && tap.y < HEADER_H2)
        return close(false);
    picker.touch(frame, rows2().length, (at) => at === index2() ? close(true) : select4(at));
  }
  function Picker() {
    return createComponent2(View, {
      get ["class"]() {
        return C.card;
      },
      get style() {
        return {
          bgColor: color("darker_background")
        };
      },
      get children() {
        return [createComponent2(Text, {
          get ["class"]() {
            return C.crumbs;
          },
          get style() {
            return {
              textColor: color("accent")
            };
          },
          get children() {
            return mode()?.kind === "themes" ? "Theme" : "Image";
          }
        }), createComponent2(Text, {
          class: "absolute right-[12] top-[6] font-mono text-xs leading-[16]",
          get style() {
            return {
              textColor: color("dark_foreground")
            };
          },
          get children() {
            return `${index2() + 1}/${rows2().length}`;
          }
        }), createComponent2(View, {
          get ["class"]() {
            return C.cardRule;
          },
          get style() {
            return {
              bgColor: color("muted")
            };
          }
        }), createComponent2(List, {
          state: picker,
          items: rows2,
          top: HEADER_H2,
          rowH: ROW_H4,
          width: CARD_W - 16,
          selected: index2,
          children: (row, at) => createComponent2(Text, {
            get ["class"]() {
              return C.label;
            },
            get style() {
              return {
                insetL: 12,
                textColor: color(at === index2() ? "bright_foreground" : "foreground")
              };
            },
            get children() {
              return labelForPath(row().filePath);
            }
          })
        })];
      }
    });
  }

  // shell/src/stage/menu.tsx
  var H = CARD_H;
  var HEADER_H3 = 26;
  var ROW_H5 = 22;
  var ROWS3 = Math.floor((H - HEADER_H3 - 4) / ROW_H5);
  var CHECK2 = "\uDB80\uDD2C";
  var CHEVRON = "\uDB80\uDD42";
  var ERROR5 = "\uDB80\uDD5A";
  var INFO = "\uDB80\uDEFC";
  var APP = "\uDB80\uDD8D";
  var APPLET = "\uDB82\uDF8A";
  var TERMINAL = "\uDB80\uDD8D";
  var AGENT = "\uDB81\uDEA9";
  var levelFor = (title, items) => ({
    title,
    items,
    selected: items[0]?.id ?? "",
    scroll: 0,
    filter: ""
  });
  {
    const setup = MENU.find((item) => item.id === "setup");
    if (setup && !setup.children.some((item) => item.id === "setup.proxy")) {
      const at = setup.children.findIndex((item) => item.id === "setup.network");
      setup.children.splice(at + 1, 0, row("setup.proxy", "\uDB81\uDD82", "Proxy", "omarchy-shell shell summon omarchy.proxy"));
    }
    if (setup && !setup.children.some((item) => item.id === "setup.tailscale")) {
      const at = setup.children.findIndex((item) => item.id === "setup.proxy");
      setup.children.splice(at + 1, 0, row("setup.tailscale", "\uDB80\uDF18", "Tailscale", "omarchy-shell shell summon omarchy.tailscale"));
    }
  }
  var [stack, setStack] = createSignal([levelFor(ROOT_TITLE, MENU)]);
  var [menuOpen, setMenuOpen] = createSignal(false);
  function toggleMenu() {
    if (!menuOpen()) {
      setStack((s) => s.slice(0, 1));
      refreshApps();
    }
    setMenuOpen(!menuOpen());
  }
  function closeMenu() {
    if (!menuOpen())
      return;
    setMenuOpen(false);
    setStack((s) => s.slice(0, 1));
  }
  var [truth, setTruth] = createSignal({});
  var level = () => stack()[stack().length - 1];
  var [allApps, setAllApps] = createSignal([]);
  function matchRank(label, needle) {
    const text = label.toLowerCase();
    if (text === needle)
      return 0;
    if (text.startsWith(needle))
      return 1;
    const at = text.indexOf(needle);
    if (at < 0)
      return null;
    return /[\s._-]/.test(text[at - 1] ?? "") ? 2 : 3;
  }
  var rows3 = (l) => {
    const admitted = shown(l.items, truth());
    if (!l.filter)
      return admitted;
    const needle = l.filter.toLowerCase();
    const apps = l.title === ROOT_TITLE ? allApps() : [];
    const ranked = [...apps, ...admitted].flatMap((item, order) => {
      const rank = matchRank(item.label, needle);
      return rank === null ? [] : [{
        item,
        rank,
        order
      }];
    });
    return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map((entry) => entry.item);
  };
  var indexIn = (l) => Math.max(0, rows3(l).findIndex((item) => item.id === l.selected));
  function evaluate(items) {
    const commands = conditionsOf(items);
    if (!commands.length)
      return;
    conditions(commands).then((results) => setTruth((t) => ({
      ...t,
      ...Object.fromEntries(commands.map((c, i) => [c, results[i]]))
    })), () => {});
  }
  var update = (change) => setStack((s) => [...s.slice(0, -1), change(s[s.length - 1])]);
  var list3 = null;
  var entering = 1;
  function select5(index) {
    const l = level();
    const shownRows = rows3(l);
    const item = shownRows[index];
    if (!item)
      return;
    update((v) => ({
      ...v,
      selected: item.id
    }));
    list3?.reveal(index, shownRows.length);
  }
  function move2(delta) {
    const shownRows = rows3(level());
    if (!shownRows.length)
      return;
    select5(Math.max(0, Math.min(shownRows.length - 1, indexIn(level()) + delta)));
  }
  function push(item) {
    remember();
    entering = 1;
    setStack((s) => [...s, levelFor(item.title, item.children)]);
    evaluate(item.children);
  }
  function back() {
    if (stack().length <= 1)
      return;
    entering = -1;
    setStack((s) => s.slice(0, -1));
  }
  function remember() {
    const first = list3?.first() ?? 0;
    update((v) => ({
      ...v,
      scroll: first
    }));
  }
  function setFilter(filter) {
    update((v) => ({
      ...v,
      filter
    }));
    list3?.reset();
    const first = rows3(level())[0];
    if (first)
      update((v) => ({
        ...v,
        selected: first.id
      }));
  }
  var selectedItem = () => {
    const l = level();
    return rows3(l)[indexIn(l)];
  };
  var openItem = (item) => activate(item);
  var atRoot = () => stack().length === 1;
  function lastLine(text) {
    const lines = text.trim().split(`
`);
    return lines[lines.length - 1] ?? "";
  }
  var MARKS = {
    youtube: "\uDB81\uDDC3",
    github: "\uDB80\uDEA4",
    discord: "\uDB81\uDE6F",
    x: "\uDB81\uDD44",
    "hacker news": "",
    hn: "",
    weather: "\uDB81\uDD95",
    maps: "\uDB80\uDF4D",
    podcasts: "\uDB82\uDD94",
    "home assistant": "\uDB81\uDFD0",
    home: "\uDB81\uDFD0"
  };
  var iconOf = (app) => app.applet ? MARKS[app.name.toLowerCase()] ?? APPLET : APP;
  var appRows = () => {
    const windows = [{
      ...row("apps.terminal", TERMINAL, "Terminal", ""),
      open: "terminal"
    }, {
      ...row("apps.agent", AGENT, "Agent", ""),
      open: "agent"
    }, ...applets().map((a) => ({
      ...row(`apps.${a.id}`, a.icon, a.title, ""),
      open: a.id
    }))];
    return request({
      method: "apps"
    }).then((apps) => [...windows, ...apps.map((a) => ({
      ...row(`apps.${a.id}`, iconOf(a), a.name, a.command),
      applet: a.applet,
      aux: a.aux,
      appletSurface: a.appletSurface
    }))], () => windows);
  };
  function refreshApps() {
    appRows().then(setAllApps);
  }
  function openProvider(item) {
    const fill = (rows) => {
      if (!rows.length)
        return toast({
          icon: INFO,
          title: item.label,
          body: "Nothing to list",
          tone: "info"
        });
      remember();
      entering = 1;
      setStack((s) => [...s, levelFor(item.title, rows)]);
    };
    const failed = (error) => toast({
      icon: ERROR5,
      title: item.label,
      body: String(error),
      tone: "error"
    });
    if (item.provider === "apps") {
      appRows().then(fill);
    } else if (PROVIDERS[item.provider]) {
      run(PROVIDERS[item.provider].script).then((result) => fill(providerRows(item.id, item.provider, result.stdout)), failed);
    } else
      toast({
        icon: INFO,
        title: item.label,
        body: `The ${item.provider} list is not in Omarchy Pocket`,
        tone: "info"
      });
  }
  function activate(item) {
    if (item.children.length)
      return push(item);
    if (item.disabled && truth()[item.disabled])
      return;
    if (item.provider)
      return openProvider(item);
    if (item.open) {
      if (openWindow(item.open))
        closeMenu();
      return;
    }
    if (item.applet) {
      closeMenu();
      openPackage(item.applet, item.label, item.aux === true, item.appletSurface === true);
      return;
    }
    if (item.action) {
      closeMenu();
      run(item.action).then((result) => {
        if (result.code !== 0) {
          toast({
            icon: ERROR5,
            title: `${item.label} failed (${result.code ?? "signal"})`,
            body: lastLine(result.stderr) || lastLine(result.stdout),
            tone: "error"
          });
        }
      }, (error) => toast({
        icon: ERROR5,
        title: item.label,
        body: String(error),
        tone: "error"
      }));
    }
  }
  function summon(id) {
    const path = id === "root" ? [] : pathTo(MENU, id);
    if (!path)
      return false;
    const levels = [levelFor(ROOT_TITLE, MENU)];
    for (const item of path) {
      levels[levels.length - 1].selected = item.id;
      if (item.children.length)
        levels.push(levelFor(item.title, item.children));
    }
    setStack(levels);
    for (const l of levels)
      evaluate(l.items);
    return true;
  }
  function summonPlugin(id, payloadJson) {
    if (id === "omarchy.menu") {
      let menu = "root";
      try {
        menu = JSON.parse(payloadJson || "{}").menu || "root";
      } catch {}
      summon(menu);
      refreshApps();
      setMenuOpen(true);
      return "ok";
    }
    const panelName = id.replace(/^omarchy\./, "");
    if (PANELS.includes(panelName)) {
      showPanel(panelName);
      return "ok";
    }
    if (id === "omarchy.image-picker") {
      let source = "";
      try {
        source = JSON.parse(payloadJson || "{}").source || "";
      } catch {}
      if (source === "themes") {
        openThemePicker();
        return "ok";
      }
    }
    toast({
      icon: INFO,
      title: id,
      body: "This Omarchy panel is not in Omarchy Pocket yet",
      tone: "info"
    });
    return "missing";
  }
  serve("shell", {
    summon: summonPlugin,
    toggle: summonPlugin
  });
  evaluate(MENU);
  refreshApps();
  function menuKey(name) {
    const l = level();
    switch (name) {
      case "Up":
        return move2(-1);
      case "Down":
        return move2(1);
      case "Enter":
      case "Right": {
        const item = rows3(l)[indexIn(l)];
        if (item)
          activate(item);
        return;
      }
      case "Left":
        return back();
      case "Backspace":
        if (l.filter)
          return setFilter(l.filter.slice(0, -1));
        return atRoot() ? closeMenu() : back();
      case "Escape":
        if (l.filter)
          return setFilter("");
        return closeMenu();
    }
  }
  function menuText(ch) {
    if (ch === " " && !level().filter)
      return;
    setFilter(level().filter + ch);
  }
  function menuTouch(frame) {
    for (const tap of frame.taps)
      if (!tap.moved && tap.y < HEADER_H3)
        return atRoot() ? closeMenu() : back();
    const shownRows = rows3(level());
    list3?.touch(frame, shownRows.length, (index) => {
      const item = shownRows[index];
      if (!item)
        return;
      if (item.id === level().selected)
        activate(item);
      else
        select5(index);
    });
  }
  function Row(props) {
    const disabled = () => !!props.item().disabled && truth()[props.item().disabled] === true;
    const checked = () => props.item().current === true || !!props.item().checked && truth()[props.item().checked] === true;
    const pinned = () => props.item().id.startsWith("apps.") && pinIds(allApps()).includes(props.item().id);
    return [createComponent2(Text, {
      get ["class"]() {
        return C.icon;
      },
      get style() {
        return {
          textColor: color(props.selected() ? "accent" : "dark_foreground")
        };
      },
      get children() {
        return props.item().icon;
      }
    }), createComponent2(Text, {
      get ["class"]() {
        return C.label;
      },
      get style() {
        return {
          textColor: color(disabled() ? "dark_foreground" : props.selected() ? "bright_foreground" : "foreground"),
          ...cjk(props.item().label, CJK_SLOT_14)
        };
      },
      get children() {
        return props.item().label;
      }
    }), createComponent2(Show, {
      get when() {
        return props.item().children.length > 0 || checked() || pinned();
      },
      get children() {
        return createComponent2(Text, {
          get ["class"]() {
            return C.chevron;
          },
          get style() {
            return {
              textColor: color(checked() ? "accent" : "dark_foreground")
            };
          },
          get children() {
            return memo2(() => props.item().children.length > 0)() ? CHEVRON : checked() ? CHECK2 : PIN;
          }
        });
      }
    })];
  }
  function Level() {
    const l = level();
    const state = createList(ROW_H5, HEADER_H3, ROWS3, Math.max(0, Math.min(l.scroll, rows3(l).length - ROWS3)));
    list3 = state;
    let node;
    onMount(() => {
      place(node, "translateX", entering * 48);
      place(node, "opacity", 0);
      glide(node, "translateX", 0, 160);
      glide(node, "opacity", 1, 160);
    });
    return createComponent2(View, {
      get ["class"]() {
        return C.card;
      },
      ref: (n) => node = n,
      get children() {
        return [createComponent2(List, {
          state,
          items: () => rows3(level()),
          top: HEADER_H3,
          rowH: ROW_H5,
          width: CARD_W - 16,
          selected: () => indexIn(level()),
          children: (item) => createComponent2(Row, {
            item,
            selected: () => level().selected === item().id
          })
        }), createComponent2(Show, {
          get when() {
            return memo2(() => !!level().filter)() && rows3(level()).length === 0;
          },
          get children() {
            return createComponent2(Text, {
              class: "absolute left-0 text-center font-mono text-xs leading-[14]",
              get style() {
                return {
                  insetT: HEADER_H3 + 40,
                  width: CARD_W,
                  textColor: color("dark_foreground")
                };
              },
              get children() {
                return `nothing here matches "${level().filter}"`;
              }
            });
          }
        })];
      }
    });
  }
  function MenuCard() {
    const crumbs = () => stack().map((l) => l.title).join(`  ${CHEVRON}  `);
    const levelItems = createMemo(() => level().items);
    return createComponent2(View, {
      get ["class"]() {
        return C.card;
      },
      get style() {
        return {
          bgColor: color("darker_background")
        };
      },
      get children() {
        return [createComponent2(Text, {
          get ["class"]() {
            return C.crumbs;
          },
          get style() {
            return {
              textColor: color("accent")
            };
          },
          get children() {
            return crumbs();
          }
        }), createComponent2(Show, {
          get when() {
            return level().filter;
          },
          get children() {
            return createComponent2(Text, {
              class: "absolute right-[12] top-[6] font-mono text-sm leading-[16]",
              get style() {
                return {
                  textColor: color("bright_foreground")
                };
              },
              get children() {
                return `${level().filter}_`;
              }
            });
          }
        }), createComponent2(View, {
          get ["class"]() {
            return C.cardRule;
          },
          get style() {
            return {
              bgColor: color("muted")
            };
          }
        }), createComponent2(Show, {
          get when() {
            return levelItems();
          },
          keyed: true,
          children: (_items) => createComponent2(Level, {})
        })];
      }
    });
  }

  // shell/src/chords.ts
  var DPAD = BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN;
  var FACE_ORDER = [BTN.TRIANGLE, BTN.SQUARE, BTN.CIRCLE, BTN.CROSS];
  var CHORDS = [{
    layer: "window",
    button: BTN.LEFT,
    action: "focus.left"
  }, {
    layer: "window",
    button: BTN.RIGHT,
    action: "focus.right"
  }, {
    layer: "window",
    button: BTN.UP,
    action: "focus.up"
  }, {
    layer: "window",
    button: BTN.DOWN,
    action: "focus.down"
  }, {
    layer: "window",
    button: BTN.CIRCLE,
    action: "menu"
  }, {
    layer: "window",
    button: BTN.CROSS,
    action: "close"
  }, {
    layer: "window",
    button: BTN.TRIANGLE,
    action: "fullscreen"
  }, {
    layer: "window",
    button: BTN.SQUARE,
    action: "split"
  }, {
    layer: "window",
    button: BTN.START,
    action: "layout"
  }, {
    layer: "window",
    button: BTN.SELECT,
    action: "keys"
  }, {
    layer: "window",
    button: BTN.ZL,
    action: "shrink"
  }, {
    layer: "window",
    button: BTN.ZR,
    action: "grow"
  }, {
    layer: "move",
    button: BTN.LEFT,
    action: "swap.left"
  }, {
    layer: "move",
    button: BTN.RIGHT,
    action: "swap.right"
  }, {
    layer: "move",
    button: BTN.UP,
    action: "swap.up"
  }, {
    layer: "move",
    button: BTN.DOWN,
    action: "swap.down"
  }, {
    layer: "move",
    button: BTN.CIRCLE,
    action: "another"
  }, {
    layer: "move",
    button: BTN.CROSS,
    action: "reopen"
  }, {
    layer: "move",
    button: BTN.TRIANGLE,
    action: "maximize"
  }, {
    layer: "move",
    button: BTN.SQUARE,
    action: "swapsplit"
  }, {
    layer: "move",
    button: BTN.START,
    action: "wallpaper"
  }, {
    layer: "move",
    button: BTN.SELECT,
    action: "bar"
  }, {
    layer: "move",
    button: BTN.ZL,
    action: "pan.left"
  }, {
    layer: "move",
    button: BTN.ZR,
    action: "pan.right"
  }, {
    layer: "workspace",
    button: BTN.LEFT,
    action: "ws.prev"
  }, {
    layer: "workspace",
    button: BTN.RIGHT,
    action: "ws.next"
  }, {
    layer: "workspace",
    button: BTN.UP,
    action: "carry.prev"
  }, {
    layer: "workspace",
    button: BTN.DOWN,
    action: "carry.next"
  }, {
    layer: "plain",
    button: BTN.ZL,
    action: "ws.prev"
  }, {
    layer: "plain",
    button: BTN.ZR,
    action: "ws.next"
  }];
  var MODIFIERS = BTN.LTRIGGER | BTN.RTRIGGER;
  var HELD_LAYERS = ["window", "move", "workspace"];
  function layerOf(held) {
    const l = (held & BTN.LTRIGGER) !== 0;
    const r = (held & BTN.RTRIGGER) !== 0;
    return l && r ? "workspace" : l ? "window" : r ? "move" : "plain";
  }
  var chordsOf = (layer) => CHORDS.filter((c) => c.layer === layer);
  var chordFor = (layer, button) => CHORDS.find((c) => c.layer === layer && c.button === button);
  var LAYER_TITLE = {
    plain: "",
    window: "L1  window",
    move: "R1  move",
    workspace: "L1+R1  workspace"
  };
  function labelFor(action, layout) {
    switch (action) {
      case "focus.left":
      case "focus.right":
      case "focus.up":
      case "focus.down":
        return "focus window";
      case "swap.left":
      case "swap.right":
      case "swap.up":
      case "swap.down":
        return "swap window";
      case "ws.prev":
      case "ws.next":
        return "switch workspace";
      case "carry.prev":
      case "carry.next":
        return "carry window";
      case "menu":
        return "menu";
      case "close":
        return "close window";
      case "fullscreen":
        return "fullscreen";
      case "split":
        return layout === "dwindle" ? "toggle split" : "column width";
      case "layout":
        return layout === "dwindle" ? "scroll layout" : "tile layout";
      case "keys":
        return "key sheet";
      case "shrink":
      case "grow":
        return layout === "dwindle" ? "resize" : "column width";
      case "another":
        return "open another";
      case "reopen":
        return "reopen closed";
      case "maximize":
        return "maximize";
      case "swapsplit":
        return layout === "dwindle" ? "swap split" : "(un)stack";
      case "wallpaper":
        return "next wallpaper";
      case "bar":
        return "toggle bar";
      case "pan.left":
      case "pan.right":
        return "pan the strip";
    }
  }
  function dpadLabel(layer) {
    switch (layer) {
      case "window":
        return "focus window";
      case "move":
        return "swap window";
      case "workspace":
        return "← → switch  ↑ ↓ carry";
      case "plain":
        return "arrows";
    }
  }
  var stickLabel = (layer) => layer === "move" ? "resize" : "";
  function glyphFor(action, layout) {
    const dwindle = layout === "dwindle";
    switch (action) {
      case "focus.left":
      case "focus.right":
      case "focus.up":
      case "focus.down":
        return {
          icon: "\uDB81\uDCFE",
          word: "Focus"
        };
      case "swap.left":
      case "swap.right":
      case "swap.up":
      case "swap.down":
        return {
          icon: "\uDB81\uDCE1",
          word: "Swap"
        };
      case "ws.prev":
        return {
          icon: "\uDB80\uDD41",
          word: "Workspace"
        };
      case "ws.next":
        return {
          icon: "\uDB80\uDD42",
          word: "Workspace"
        };
      case "carry.prev":
        return {
          icon: "\uDB80\uDD1D",
          word: "Carry"
        };
      case "carry.next":
        return {
          icon: "\uDB80\uDD20",
          word: "Carry"
        };
      case "menu":
        return {
          icon: "",
          word: "Menu",
          small: true
        };
      case "close":
        return {
          icon: "\uDB80\uDD56",
          word: "Close"
        };
      case "fullscreen":
        return {
          icon: "\uDB80\uDE93",
          word: "Full"
        };
      case "split":
        return dwindle ? {
          icon: "\uDB82\uDFCC",
          word: "Split"
        } : {
          icon: "\uDB81\uDCEF",
          word: "Width"
        };
      case "layout":
        return dwindle ? {
          icon: "\uDB81\uDD6D",
          word: "Scroll"
        } : {
          icon: "\uDB81\uDD74",
          word: "Tile"
        };
      case "keys":
        return {
          icon: "\uDB80\uDF0C",
          word: "Keys"
        };
      case "shrink":
        return {
          icon: "\uDB80\uDF74",
          word: "Shrink"
        };
      case "grow":
        return {
          icon: "\uDB81\uDC15",
          word: "Grow"
        };
      case "another":
        return {
          icon: "\uDB81\uDC16",
          word: "New"
        };
      case "reopen":
        return {
          icon: "\uDB82\uDD9B",
          word: "Reopen"
        };
      case "maximize":
        return {
          icon: "\uDB81\uDDAF",
          word: "Max"
        };
      case "swapsplit":
        return dwindle ? {
          icon: "\uDB84\uDCE7",
          word: "Flip"
        } : {
          icon: "\uDB82\uDFCB",
          word: "Stack"
        };
      case "wallpaper":
        return {
          icon: "\uDB80\uDEE9",
          word: "Wallpaper"
        };
      case "bar":
        return {
          icon: "\uDB85\uDD13",
          word: "Bar"
        };
      case "pan.left":
        return {
          icon: "\uDB80\uDD41",
          word: "Pan"
        };
      case "pan.right":
        return {
          icon: "\uDB80\uDD42",
          word: "Pan"
        };
    }
  }
  var LAYER_GLYPH = {
    plain: {
      icon: "",
      word: ""
    },
    window: {
      icon: "\uDB81\uDE14",
      word: "Window"
    },
    move: {
      icon: "\uDB80\uDDBE",
      word: "Move"
    },
    workspace: {
      icon: "\uDB81\uDD6C",
      word: "Workspace"
    }
  };
  var stickGlyph = (layer) => stickLabel(layer) ? {
    icon: "\uDB80\uDC4C",
    word: "Resize"
  } : null;
  function triggerLabel(layer, layout) {
    switch (layer) {
      case "window":
        return layout === "dwindle" ? "shrink / grow" : "column width";
      case "move":
        return layout === "scrolling" ? "pan the strip" : "—";
      case "workspace":
        return "—";
      case "plain":
        return "switch workspace";
    }
  }
  var BUTTON_NAME = {
    [BTN.CIRCLE]: "A",
    [BTN.CROSS]: "B",
    [BTN.TRIANGLE]: "X",
    [BTN.SQUARE]: "Y",
    [BTN.START]: "START",
    [BTN.SELECT]: "SELECT",
    [BTN.ZL]: "L2",
    [BTN.ZR]: "R2"
  };
  function keySheet(layout) {
    const prefix = {
      plain: "",
      window: "L1 +",
      move: "R1 +",
      workspace: "L1+R1"
    };
    const groups = [];
    for (const layer of HELD_LAYERS) {
      const rows = [{
        keys: `${prefix[layer]} d-pad`,
        what: layer === "workspace" ? "switch · carry" : dpadLabel(layer)
      }];
      const stick = stickLabel(layer);
      if (stick)
        rows.push({
          keys: `${prefix[layer]} stick`,
          what: stick
        });
      const triggers = triggerLabel(layer, layout);
      if (triggers !== "—")
        rows.push({
          keys: `${prefix[layer]} L2/R2`,
          what: triggers
        });
      for (const chord of chordsOf(layer)) {
        if (chord.button & (DPAD | BTN.ZL | BTN.ZR))
          continue;
        rows.push({
          keys: `${prefix[layer]} ${BUTTON_NAME[chord.button]}`,
          what: labelFor(chord.action, layout)
        });
      }
      groups.push({
        title: LAYER_TITLE[layer],
        rows
      });
    }
    groups.push({
      title: "no shoulder",
      rows: [{
        keys: "d-pad",
        what: "arrows"
      }, {
        keys: "A B X Y",
        what: "Enter Bksp Tab Space"
      }, {
        keys: "START",
        what: "Escape"
      }, {
        keys: "SELECT",
        what: "Keys · Pad · Home"
      }, {
        keys: "L2 / R2",
        what: "switch workspace"
      }]
    });
    return groups;
  }

  // shell/src/stage/keysheet.tsx
  var [open3, setOpen] = createSignal(false);
  var sheetOpen = open3;
  var toggleSheet = () => setOpen((o) => !o);
  var closeSheet = () => setOpen(false);
  var LINE = 15;
  var COL_W = 236;
  var KEYS_W = 96;
  function lines(groups) {
    const all = keySheet(layout());
    const out = [];
    for (const index of groups) {
      const group = all[index];
      out.push({
        kind: "title",
        keys: group.title,
        what: ""
      });
      for (const row of group.rows)
        out.push({
          kind: "row",
          ...row
        });
      out.push({
        kind: "gap",
        keys: "",
        what: ""
      });
    }
    return out;
  }
  function Column(props) {
    return createComponent2(For, {
      get each() {
        return lines(props.groups);
      },
      children: (line, i) => createComponent2(Show, {
        get when() {
          return line.kind !== "gap";
        },
        get children() {
          return [createComponent2(Text, {
            class: "absolute h-[15] overflow-hidden font-mono text-xs leading-[15]",
            get style() {
              return {
                insetL: props.x,
                insetT: 44 + i() * LINE,
                width: line.kind === "title" ? COL_W : KEYS_W,
                textColor: color(line.kind === "title" ? "accent" : "bright_foreground")
              };
            },
            get children() {
              return line.keys;
            }
          }), createComponent2(Show, {
            get when() {
              return line.kind === "row";
            },
            get children() {
              return createComponent2(Text, {
                class: "absolute h-[15] overflow-hidden font-mono text-xs leading-[15]",
                get style() {
                  return {
                    insetL: props.x + KEYS_W,
                    insetT: 44 + i() * LINE,
                    width: COL_W - KEYS_W,
                    textColor: color("foreground")
                  };
                },
                get children() {
                  return line.what;
                }
              });
            }
          })];
        }
      })
    });
  }
  function KeySheet() {
    return createComponent2(Show, {
      get when() {
        return open3();
      },
      get children() {
        return createComponent2(View, {
          class: "absolute left-[12] top-[24] w-[488] h-[348] rounded-md border-[1]",
          get style() {
            return {
              bgColor: color("background", 0.96),
              borderColor: color("accent")
            };
          },
          ref: (node) => {
            jump(node, "opacity", 0);
            animate(node, "opacity", 1, {
              dur: 150,
              easing: "out"
            });
          },
          get children() {
            return [createComponent2(Text, {
              class: "absolute left-[12] top-[8] font-mono text-sm leading-[16]",
              get style() {
                return {
                  textColor: color("bright_foreground")
                };
              },
              children: "Keys"
            }), createComponent2(Text, {
              class: "absolute right-[12] top-[9] font-mono text-xs leading-[14]",
              get style() {
                return {
                  textColor: color("dark_foreground")
                };
              },
              children: "L1 + SELECT closes"
            }), createComponent2(View, {
              class: "absolute left-[12] top-[30] w-[464] h-[1]",
              get style() {
                return {
                  bgColor: color("muted")
                };
              }
            }), createComponent2(Column, {
              x: 0 + 12,
              groups: [0, 3]
            }), createComponent2(Column, {
              x: 12 + COL_W,
              groups: [1, 2]
            })];
          }
        });
      }
    });
  }

  // shell/src/actions.ts
  var INFO2 = "\uDB80\uDEFC";
  var say = (title) => toast({
    icon: INFO2,
    title,
    body: "",
    tone: "info"
  }, 1.8);
  var fail4 = (title) => (result) => {
    if (result.code !== 0)
      toast({
        icon: "\uDB80\uDD5A",
        title,
        body: result.stderr.trim().split(`
`).pop() ?? "",
        tone: "error"
      });
  };
  function closeFocused() {
    const w = focused2();
    if (!w)
      return say("Nothing to close");
    if (w.kind === "terminal")
      closeTerminal(w.sid);
    else if (w.kind === "app")
      closePackage(w.app);
    else
      act((m) => m.close(w.id));
  }
  var must = (change, why) => {
    if (!act(change))
      say(why);
  };
  function perform(action) {
    switch (action) {
      case "focus.left":
      case "focus.right":
      case "focus.up":
      case "focus.down":
        return must((m) => m.focusDir(action.slice(6)), focused2() ? "No window that way" : "No window here");
      case "swap.left":
      case "swap.right":
      case "swap.up":
      case "swap.down":
        return must((m) => m.swapDir(action.slice(5)), focused2() ? "No window that way" : "No window here");
      case "ws.prev":
        return act((m) => m.stepWs(-1));
      case "ws.next":
        return act((m) => m.stepWs(1));
      case "carry.prev":
        return must((m) => m.carry(-1), "No window to carry");
      case "carry.next":
        return must((m) => m.carry(1), "No window to carry");
      case "menu":
        return toggleMenu();
      case "close":
        return closeFocused();
      case "fullscreen":
        return focused2() ? act((m) => m.toggleFullscreen("full")) : say("No window here");
      case "maximize":
        return focused2() ? act((m) => m.toggleFullscreen("max")) : say("No window here");
      case "split":
        return must((m) => m.toggleSplit(), "A split needs two windows");
      case "swapsplit":
        return must((m) => m.swapSplit(), "A split needs two windows");
      case "layout": {
        const next = act((m) => m.toggleLayout());
        return say(`Layout: ${next}`);
      }
      case "shrink":
        return must((m) => m.resize(-1), "A split needs two windows");
      case "grow":
        return must((m) => m.resize(1), "A split needs two windows");
      case "pan.left":
        return must((m) => m.pan(-1), "Panning needs the scrolling layout");
      case "pan.right":
        return must((m) => m.pan(1), "Panning needs the scrolling layout");
      case "keys":
        return toggleSheet();
      case "another": {
        const w = focused2();
        if (!w)
          return openTerminal();
        if (w.kind === "terminal")
          return openTerminal();
        if (w.kind === "app")
          return openPackage(w.path, w.title, w.aux, w.appletSurface);
        return say(`${appletById(w.applet)?.title ?? w.applet} has one window`);
      }
      case "reopen": {
        const last = takeClosed();
        if (!last)
          return say("Nothing closed yet");
        if (last.kind === "terminal")
          return openTerminal();
        if (last.kind === "app")
          return openPackage(last.path, last.title, last.aux, last.appletSurface);
        return openApplet(last.applet);
      }
      case "wallpaper":
        say("Next background");
        return void run("omarchy-theme-bg-next").then(fail4("Next background"), () => {});
      case "bar":
        say("Toggling the bar");
        return void run("omarchy-toggle-bar").then(fail4("Toggle bar"), () => {});
    }
  }
  createRoot(() => createEffect(() => {
    const bar = state()?.bar;
    act((m) => m.bar = !bar ? "top" : bar.hidden ? "none" : bar.position === "bottom" ? "bottom" : "top");
  }));

  // shell/src/deck/geometry.ts
  var STRIP_H = 34;
  var BODY_TOP = STRIP_H;
  var BODY_H = 384 - STRIP_H;
  var KEYS_TOP = 2;
  var KEY_PITCH = 44;
  var KEYS_BOTTOM = KEYS_TOP + 4 * KEY_PITCH;
  var PAD_X = 62;
  var PAD_W = 512 - 2 * PAD_X;
  var PAD_BOTTOM = BODY_H - 6;
  var PAD_SMALL = {
    x: PAD_X,
    y: KEYS_BOTTOM + 6,
    w: PAD_W,
    h: PAD_BOTTOM - KEYS_BOTTOM - 6
  };
  var PAD_LARGE = {
    x: PAD_X,
    y: 6,
    w: PAD_W,
    h: PAD_BOTTOM - 6
  };
  var ROUND = 44;
  var ROUND_GAP = 8;
  var LEFT_X = (PAD_X - ROUND) / 2;
  var RIGHT_X = 512 - PAD_X + LEFT_X;
  var ROUNDS = {
    voice: {
      x: LEFT_X,
      y: PAD_BOTTOM - 2 * ROUND - ROUND_GAP,
      w: ROUND,
      h: ROUND
    },
    hold: {
      x: LEFT_X,
      y: PAD_BOTTOM - ROUND,
      w: ROUND,
      h: ROUND
    },
    toggle: {
      x: RIGHT_X,
      y: PAD_BOTTOM - 2 * ROUND - ROUND_GAP,
      w: ROUND,
      h: ROUND
    },
    close: {
      x: RIGHT_X,
      y: PAD_BOTTOM - ROUND,
      w: ROUND,
      h: ROUND
    }
  };
  var inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  // shell/src/held.ts
  var [held, setHeld] = createSignal("plain");

  // shell/src/generated/glyph-ink.ts
  var INK = {
    "\uDB80\uDC26": 0.159,
    "\uDB80\uDC3B": 0.034,
    "\uDB80\uDC45": 0.03,
    "\uDB80\uDC4C": 0.075,
    "\uDB80\uDC4D": 0.03,
    "\uDB80\uDC54": 0.03,
    "\uDB80\uDC5D": 0.03,
    "\uDB80\uDC6E": 0.2,
    "\uDB80\uDC85": 0.138,
    "\uDB80\uDC86": 0.138,
    "\uDB80\uDC87": 0.138,
    "\uDB80\uDC88": 0.138,
    "\uDB80\uDC89": 0.138,
    "\uDB80\uDC8A": 0.138,
    "\uDB80\uDC8B": 0.138,
    "\uDB80\uDC9A": 0.075,
    "\uDB80\uDC9B": 0.138,
    "\uDB80\uDCB1": 0.075,
    "\uDB80\uDCB2": 0.034,
    "\uDB80\uDCB5": 0.096,
    "\uDB80\uDCC9": 0.055,
    "\uDB80\uDCDF": 0.171,
    "\uDB80\uDD00": 0.116,
    "\uDB80\uDD1D": 0.116,
    "\uDB80\uDD20": 0.116,
    "\uDB80\uDD2C": 0.065,
    "\uDB80\uDD41": -0.011,
    "\uDB80\uDD42": 0.012,
    "\uDB80\uDD47": 0.075,
    "\uDB80\uDD59": 0.116,
    "\uDB80\uDD5A": 0.116,
    "\uDB80\uDD5F": 0.2,
    "\uDB80\uDD8D": 0.116,
    "\uDB80\uDD8F": 0.096,
    "\uDB80\uDDBD": 0.051,
    "\uDB80\uDDBE": 0.128,
    "\uDB80\uDDD6": 0.075,
    "\uDB80\uDDD8": 0.034,
    "\uDB80\uDDE7": 0.116,
    "\uDB80\uDDE9": 0.112,
    "\uDB80\uDE00": 0.116,
    "\uDB80\uDE02": 0.075,
    "\uDB80\uDE08": 0.159,
    "\uDB80\uDE09": 0.159,
    "\uDB80\uDE37": 0.075,
    "\uDB80\uDE49": 0.075,
    "\uDB80\uDE9A": 0.116,
    "\uDB80\uDEA4": 0.116,
    "\uDB80\uDEAD": 0.106,
    "\uDB80\uDEAF": 0.116,
    "\uDB80\uDECA": 0.034,
    "\uDB80\uDECB": 0.075,
    "\uDB80\uDEDC": 0.116,
    "\uDB80\uDEE9": 0.075,
    "\uDB80\uDEFC": 0.116,
    "\uDB80\uDEFD": 0.116,
    "\uDB80\uDF0C": 0.116,
    "\uDB80\uDF11": 0.096,
    "\uDB80\uDF2A": 0.116,
    "\uDB80\uDF3E": 0.034,
    "\uDB80\uDF43": 0.075,
    "\uDB80\uDF4D": 0.075,
    "\uDB80\uDF5C": 0.075,
    "\uDB80\uDF6D": 0.075,
    "\uDB80\uDF72": 0.096,
    "\uDB80\uDF73": 0.116,
    "\uDB80\uDF79": 0.159,
    "\uDB80\uDFD3": 0.075,
    "\uDB80\uDFD6": 0.138,
    "\uDB80\uDFD8": 0.075,
    "\uDB81\uDC04": 0.075,
    "\uDB81\uDC0B": 0.075,
    "\uDB81\uDC16": 0.075,
    "\uDB81\uDC25": 0.034,
    "\uDB81\uDC31": 0.138,
    "\uDB81\uDC32": 0.075,
    "\uDB81\uDC50": 0.034,
    "\uDB81\uDC53": 0.138,
    "\uDB81\uDCB1": 0.096,
    "\uDB81\uDCB2": 0.159,
    "\uDB81\uDCC5": 0.116,
    "\uDB81\uDCC7": 0.116,
    "\uDB81\uDCE1": 0.075,
    "\uDB81\uDCEF": 0.075,
    "\uDB81\uDCFE": 0.116,
    "\uDB81\uDD0E": 0.122,
    "\uDB81\uDD2B": 0.034,
    "\uDB81\uDD36": 0.159,
    "\uDB81\uDD44": 0.136,
    "\uDB81\uDD6C": 0.116,
    "\uDB81\uDD6D": 0.055,
    "\uDB81\uDD6E": 0.075,
    "\uDB81\uDD74": 0.055,
    "\uDB81\uDD7E": 0.075,
    "\uDB81\uDD82": 0.159,
    "\uDB81\uDD95": 0.136,
    "\uDB81\uDD9F": 0.116,
    "\uDB81\uDDA9": 0.149,
    "\uDB81\uDDAA": 0.154,
    "\uDB81\uDDAF": 0.034,
    "\uDB81\uDDB2": 0.034,
    "\uDB81\uDDBA": 0.117,
    "\uDB81\uDDC3": 0.116,
    "\uDB81\uDDD8": 0.116,
    "\uDB81\uDE07": 0.075,
    "\uDB81\uDE14": 0.159,
    "\uDB81\uDE36": 0.116,
    "\uDB81\uDE6F": 0.116,
    "\uDB81\uDEA9": 0.159,
    "\uDB81\uDEE7": 0.2,
    "\uDB81\uDEF3": 0.116,
    "\uDB81\uDF09": 0.033,
    "\uDB81\uDF5A": 0.096,
    "\uDB81\uDF5F": 0.096,
    "\uDB81\uDF63": 0.075,
    "\uDB81\uDF64": 0.075,
    "\uDB81\uDF65": 0.116,
    "\uDB81\uDF85": 0.116,
    "\uDB81\uDFD0": 0.14,
    "\uDB81\uDFF5": 0.116,
    "\uDB81\uDFF8": 0.116,
    "\uDB82\uDC68": 0.116,
    "\uDB82\uDC81": 0.159,
    "\uDB82\uDC8C": 0.086,
    "\uDB82\uDC9C": 0.138,
    "\uDB82\uDC9D": 0.138,
    "\uDB82\uDC9E": 0.138,
    "\uDB82\uDCB9": 0.159,
    "\uDB82\uDCC0": 0.054,
    "\uDB82\uDCC7": 0.116,
    "\uDB82\uDD01": 0.075,
    "\uDB82\uDD1F": 0.185,
    "\uDB82\uDD22": 0.185,
    "\uDB82\uDD25": 0.185,
    "\uDB82\uDD28": 0.185,
    "\uDB82\uDD29": 0.182,
    "\uDB82\uDD2E": 0.185,
    "\uDB82\uDD2F": 0.185,
    "\uDB82\uDD54": 0.116,
    "\uDB82\uDD66": 0.034,
    "\uDB82\uDD94": 0.138,
    "\uDB82\uDD9B": 0.138,
    "\uDB82\uDDD1": 0.127,
    "\uDB82\uDDF8": 0.138,
    "\uDB82\uDE5F": 0.075,
    "\uDB82\uDECF": 0.116,
    "\uDB82\uDF4C": 0.159,
    "\uDB82\uDF79": 0.116,
    "\uDB82\uDF8A": 0.116,
    "\uDB82\uDFC9": 0.159,
    "\uDB82\uDFCB": 0.075,
    "\uDB82\uDFCC": 0.075,
    "\uDB83\uDCFD": 0.082,
    "\uDB83\uDD11": 0.075,
    "\uDB83\uDD6E": 0.116,
    "\uDB83\uDD7D": 0.075,
    "\uDB83\uDE0C": 0.116,
    "\uDB84\uDCA9": 0.116,
    "\uDB84\uDCAC": 0.116,
    "\uDB84\uDCE7": 0.075,
    "\uDB84\uDD04": 0.159,
    "\uDB84\uDDF1": 0.2,
    "\uDB85\uDCDE": 0.121,
    "\uDB85\uDCDF": 0.121,
    "\uDB85\uDCFB": 0.075,
    "\uDB85\uDD13": 0.116,
    "\uDB85\uDEA1": 0.159,
    "\uDB85\uDEA4": 0.159,
    "\uDB85\uDEBE": 0.175,
    "\uDB86\uDCF4": 0.116,
    "": 0.075,
    "": 0.141,
    "": 0.023,
    "": 0.137,
    "": 0.137,
    "": 0.132,
    "": 0.137,
    "": 0.137,
    "": 0.067,
    "": 0.068,
    "": 0.085,
    "": 0.1,
    "": 0.09,
    "": 0.086,
    "": 0.081,
    "": 0.1,
    "": 0.092,
    "": 0.091,
    "": 0.052,
    "": 0.101,
    "": 0.03,
    "": 0.088,
    "": 0.088,
    "": 0.1,
    "": 0.1,
    "": 0.1,
    "": 0.1,
    "": 0.137,
    "": 0.169,
    "": 0.013,
    "": 0.137,
    "": 0.137,
    "": 0.167,
    "": 0.137,
    "": 0.013,
    "": 0.137,
    "": 0.103,
    "": 0.145,
    "": 0.22,
    "": 0.162,
    "": 0.162,
    "": 0.167,
    "": 0.046,
    "": 0.177,
    "": 0.133,
    "": 0.133,
    "": 0.104,
    "": 0.104,
    "": 0.277,
    "": 0.162,
    "": 0.104,
    "": 0.147,
    "": 0.219,
    "": 0.162,
    "": 0.159,
    "": 0.158,
    "": 0.162,
    "": 0.046,
    "": 0.147,
    "": 0.162,
    "": 0.162,
    "": 0.162,
    "": 0.277,
    "": 0.219,
    "": 0.046,
    "": 0.079,
    "": 0.277,
    "": 0.147,
    "": 0.104,
    "": 0.274,
    "": 0.162,
    "": 0.143,
    "": 0.162,
    "": 0.104,
    "": 0.077,
    "": 0.2,
    "": 0.138,
    "": 0.138,
    "": 0.2,
    "": 0.2,
    "": 0.2,
    "": 0.075
  };

  // shell/src/ink.ts
  var inkShift = (glyph, px) => Math.round((INK[glyph] ?? 0) * px * 2) / 2;

  // shell/src/deck/legend.tsx
  var LEGEND_AFTER = 14;
  var [due, setDue] = createSignal(false);
  function tickLegend(held, frames) {
    const next = held && frames >= LEGEND_AFTER;
    if (next !== due())
      setDue(next);
  }
  var SMALL = 16;
  var LARGE = 24;
  var LEAD = {
    [SMALL]: 18,
    [LARGE]: 28
  };
  function Icon(props) {
    const box = 40;
    return createComponent2(Text, {
      get ["class"]() {
        return props.px === LARGE ? "absolute text-center text-2xl leading-[28]" : "absolute text-center font-mono text-base leading-[18]";
      },
      get style() {
        return {
          insetL: props.cx - box / 2 - inkShift(props.glyph, props.px),
          insetT: props.cy - LEAD[props.px] / 2,
          width: box,
          height: LEAD[props.px],
          textColor: color(props.tone)
        };
      },
      get children() {
        return props.glyph;
      }
    });
  }
  function Word(props) {
    const w = props.w ?? 72;
    return createComponent2(Text, {
      class: "absolute h-[14] overflow-hidden text-center font-mono text-xs leading-[14]",
      get style() {
        return {
          insetL: props.cx - w / 2,
          insetT: props.top,
          width: w,
          textColor: color(props.tone ?? "foreground")
        };
      },
      get children() {
        return props.text;
      }
    });
  }
  var DIM = 0.32;
  function Face(props) {
    const r = 22;
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] h-[384]",
      get style() {
        return {
          opacity: props.glyph ? 1 : DIM
        };
      },
      get children() {
        return [createComponent2(View, {
          class: "absolute w-[44] h-[44] rounded-full border-[1]",
          get style() {
            return {
              insetL: props.cx - r,
              insetT: props.cy - r,
              bgColor: color("dark_background"),
              borderColor: color("muted")
            };
          }
        }), createComponent2(Show, {
          get when() {
            return props.glyph;
          },
          children: (g) => createComponent2(Icon, {
            get glyph() {
              return g().icon;
            },
            get cx() {
              return props.cx;
            },
            get cy() {
              return props.cy;
            },
            get px() {
              return g().small ? SMALL : LARGE;
            },
            tone: "bright_foreground"
          })
        }), createComponent2(View, {
          class: "absolute w-[15] h-[15] rounded-full",
          get style() {
            return {
              insetL: props.cx + r - 12,
              insetT: props.cy - r - 3,
              bgColor: color("muted")
            };
          }
        }), createComponent2(Text, {
          class: "absolute h-[15] w-[15] text-center font-mono text-xs leading-[15]",
          get style() {
            return {
              insetL: props.cx + r - 12,
              insetT: props.cy - r - 3,
              textColor: color("darker_background")
            };
          },
          get children() {
            return props.letter;
          }
        }), createComponent2(Show, {
          get when() {
            return props.glyph;
          },
          children: (g) => createComponent2(Word, {
            get text() {
              return g().word;
            },
            get cx() {
              return props.cx;
            },
            get top() {
              return props.cy + r + 3;
            }
          })
        })];
      }
    });
  }
  function Shoulder(props) {
    const w = 60;
    const h = 26;
    const y = 8;
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] h-[384]",
      get style() {
        return {
          opacity: props.lit || props.bound ? 1 : DIM
        };
      },
      get children() {
        return [createComponent2(View, {
          class: "absolute rounded-md border-[1]",
          get style() {
            return {
              insetL: props.x,
              insetT: y,
              width: w,
              height: h,
              bgColor: color(props.lit ? "accent" : "dark_background"),
              borderColor: color(props.lit ? "accent" : "muted")
            };
          }
        }), createComponent2(Show, {
          get when() {
            return props.glyph;
          },
          get fallback() {
            return createComponent2(Text, {
              class: "absolute text-center font-mono text-sm leading-[16]",
              get style() {
                return {
                  insetL: props.x,
                  insetT: y + 5,
                  width: w,
                  height: 16,
                  textColor: color(props.lit ? "darker_background" : "foreground")
                };
              },
              get children() {
                return props.name;
              }
            });
          },
          children: (g) => [createComponent2(Text, {
            class: "absolute font-mono text-xs leading-[14]",
            get style() {
              return {
                insetL: props.x + 7,
                insetT: y + 6,
                width: 20,
                height: 14,
                textColor: color("dark_foreground")
              };
            },
            get children() {
              return props.name;
            }
          }), createComponent2(Icon, {
            get glyph() {
              return g().icon;
            },
            get cx() {
              return props.x + w - 18;
            },
            cy: y + h / 2,
            px: SMALL,
            tone: "bright_foreground"
          }), createComponent2(Word, {
            get text() {
              return g().word;
            },
            get cx() {
              return props.x + w / 2;
            },
            top: y + h + 3
          })]
        })];
      }
    });
  }
  function Pill(props) {
    const x = 348;
    const w = 152;
    const h = 30;
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] h-[384]",
      get style() {
        return {
          opacity: props.glyph ? 1 : DIM
        };
      },
      get children() {
        return [createComponent2(View, {
          class: "absolute w-[152] h-[30] rounded-full border-[1]",
          get style() {
            return {
              insetL: x,
              insetT: props.y,
              bgColor: color("dark_background"),
              borderColor: color("muted")
            };
          }
        }), createComponent2(Text, {
          class: "absolute font-mono text-xs leading-[14]",
          get style() {
            return {
              insetL: x + 12,
              insetT: props.y + 8,
              width: 48,
              height: 14,
              textColor: color("dark_foreground")
            };
          },
          get children() {
            return props.name;
          }
        }), createComponent2(Show, {
          get when() {
            return props.glyph;
          },
          children: (g) => [createComponent2(Icon, {
            get glyph() {
              return g().icon;
            },
            cx: x + 70,
            get cy() {
              return props.y + h / 2;
            },
            px: SMALL,
            tone: "bright_foreground"
          }), createComponent2(Text, {
            class: "absolute overflow-hidden font-mono text-xs leading-[14]",
            get style() {
              return {
                insetL: x + 84,
                insetT: props.y + 8,
                width: w - 90,
                height: 14,
                textColor: color("foreground")
              };
            },
            get children() {
              return g().word;
            }
          })]
        })];
      }
    });
  }
  var DPAD2 = {
    cx: 104,
    cy: 150,
    arm: 40
  };
  var STICK = {
    cx: 104,
    cy: 292,
    r: 28
  };
  var FACES = {
    cx: 408,
    cy: 150,
    step: 54
  };
  function Dpad(props) {
    const arms = createMemo(() => {
      const l = layout();
      return [[BTN.LEFT, -1, 0, "\uDB80\uDD41"], [BTN.RIGHT, 1, 0, "\uDB80\uDD42"], [BTN.UP, 0, -1, "\uDB80\uDD43"], [BTN.DOWN, 0, 1, "\uDB80\uDD40"]].map(([button, dx, dy, arrow]) => {
        const chord = chordFor(props.layer, button);
        return {
          dx,
          dy,
          arrow,
          glyph: chord ? glyphFor(chord.action, l) : null
        };
      });
    });
    const one = createMemo(() => new Set(arms().map((a) => a.glyph?.word ?? "")).size === 1);
    const word = createMemo(() => one() ? arms()[0].glyph?.word ?? "" : `${arms()[0].glyph?.word ?? ""} · ${arms()[2].glyph?.word ?? ""}`);
    const {
      cx,
      cy,
      arm
    } = DPAD2;
    return [createComponent2(View, {
      class: "absolute rounded-md",
      get style() {
        return {
          insetL: cx - 1.5 * arm,
          insetT: cy - arm / 2,
          width: 3 * arm,
          height: arm,
          bgColor: color("dark_background")
        };
      }
    }), createComponent2(View, {
      class: "absolute rounded-md",
      get style() {
        return {
          insetL: cx - arm / 2,
          insetT: cy - 1.5 * arm,
          width: arm,
          height: 3 * arm,
          bgColor: color("dark_background")
        };
      }
    }), createComponent2(For, {
      get each() {
        return arms();
      },
      children: (a) => createComponent2(Icon, {
        get glyph() {
          return memo2(() => !!one())() ? a.arrow : a.glyph?.icon ?? a.arrow;
        },
        get cx() {
          return cx + a.dx * arm;
        },
        get cy() {
          return cy + a.dy * arm;
        },
        px: SMALL,
        get tone() {
          return one() ? "dark_foreground" : "bright_foreground";
        }
      })
    }), createComponent2(Show, {
      get when() {
        return memo2(() => !!one())() && arms()[0].glyph;
      },
      get children() {
        return createComponent2(Icon, {
          get glyph() {
            return arms()[0].glyph.icon;
          },
          cx,
          cy,
          px: LARGE,
          tone: "bright_foreground"
        });
      }
    }), createComponent2(Word, {
      get text() {
        return word();
      },
      cx,
      top: cy + 1.5 * arm + 6,
      w: 150
    })];
  }
  function Stick(props) {
    const glyph = () => stickGlyph(props.layer);
    const {
      cx,
      cy,
      r
    } = STICK;
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] h-[384]",
      get style() {
        return {
          opacity: glyph() ? 1 : DIM
        };
      },
      get children() {
        return [createComponent2(View, {
          class: "absolute w-[56] h-[56] rounded-full border-[1]",
          get style() {
            return {
              insetL: cx - r,
              insetT: cy - r,
              bgColor: color("dark_background"),
              borderColor: color("muted")
            };
          }
        }), createComponent2(View, {
          class: "absolute w-[28] h-[28] rounded-full",
          get style() {
            return {
              insetL: cx - r / 2,
              insetT: cy - r / 2,
              bgColor: color("muted", 0.5)
            };
          }
        }), createComponent2(Show, {
          get when() {
            return glyph();
          },
          children: (g) => [createComponent2(Icon, {
            get glyph() {
              return g().icon;
            },
            cx,
            cy,
            px: LARGE,
            tone: "bright_foreground"
          }), createComponent2(Word, {
            get text() {
              return g().word;
            },
            cx,
            top: cy + r + 4
          })]
        })];
      }
    });
  }
  function DeckLegend() {
    let node;
    const layer = createMemo((last) => held() === "plain" ? last ?? "window" : held(), "window");
    const face = (button) => {
      const chord = chordFor(layer(), button);
      return chord ? glyphFor(chord.action, layout()) : null;
    };
    const trigger = (button) => triggerLabel(layer(), layout()) === "—" ? null : face(button);
    const title = () => LAYER_GLYPH[layer()];
    createEffect(on(due, (d) => glide(node, "opacity", d ? 1 : 0, d ? 120 : 160), {
      defer: true
    }));
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] h-[384] contain-strict",
      get style() {
        return {
          bgColor: color("darker_background"),
          opacity: 0
        };
      },
      ref: (n) => node = n,
      get children() {
        return [createComponent2(Shoulder, {
          name: "L1",
          x: 12,
          get lit() {
            return layer() !== "move";
          },
          glyph: null,
          bound: true
        }), createComponent2(Shoulder, {
          name: "L2",
          x: 80,
          lit: false,
          get glyph() {
            return trigger(BTN.ZL);
          },
          get bound() {
            return !!trigger(BTN.ZL);
          }
        }), createComponent2(Shoulder, {
          name: "R2",
          x: 372,
          lit: false,
          get glyph() {
            return trigger(BTN.ZR);
          },
          get bound() {
            return !!trigger(BTN.ZR);
          }
        }), createComponent2(Shoulder, {
          name: "R1",
          x: 440,
          get lit() {
            return layer() !== "window";
          },
          glyph: null,
          bound: true
        }), createComponent2(Icon, {
          get glyph() {
            return title().icon;
          },
          cx: 256,
          cy: 136,
          px: LARGE,
          tone: "accent"
        }), createComponent2(Text, {
          class: "absolute left-[156] w-[200] text-center font-mono text-base leading-[18]",
          get style() {
            return {
              insetT: 156,
              height: 18,
              textColor: color("bright_foreground")
            };
          },
          get children() {
            return title().word;
          }
        }), createComponent2(Dpad, {
          get layer() {
            return layer();
          }
        }), createComponent2(Stick, {
          get layer() {
            return layer();
          }
        }), createComponent2(Face, {
          letter: "X",
          get cx() {
            return FACES.cx;
          },
          get cy() {
            return FACES.cy - FACES.step;
          },
          get glyph() {
            return face(BTN.TRIANGLE);
          }
        }), createComponent2(Face, {
          letter: "Y",
          get cx() {
            return FACES.cx - FACES.step;
          },
          get cy() {
            return FACES.cy;
          },
          get glyph() {
            return face(BTN.SQUARE);
          }
        }), createComponent2(Face, {
          letter: "A",
          get cx() {
            return FACES.cx + FACES.step;
          },
          get cy() {
            return FACES.cy;
          },
          get glyph() {
            return face(BTN.CIRCLE);
          }
        }), createComponent2(Face, {
          letter: "B",
          get cx() {
            return FACES.cx;
          },
          get cy() {
            return FACES.cy + FACES.step;
          },
          get glyph() {
            return face(BTN.CROSS);
          }
        }), createComponent2(Pill, {
          name: "START",
          y: 278,
          get glyph() {
            return face(BTN.START);
          }
        }), createComponent2(Pill, {
          name: "SELECT",
          y: 318,
          get glyph() {
            return face(BTN.SELECT);
          }
        })];
      }
    });
  }

  // shell/src/stage/card.tsx
  var card = () => pickerOpen() ? "picker" : panel() ? "panel" : menuOpen() ? "menu" : null;
  function cardKey(name) {
    switch (card()) {
      case "picker":
        return pickerKey(name);
      case "panel":
        return panelKey(name);
      case "menu":
        return menuKey(name);
    }
  }
  function cardText(ch) {
    if (card() === "menu")
      menuText(ch);
  }
  function cardButton(button) {
    if (card() === "panel" && button & BTN.SQUARE) {
      panelKey("Forget");
      return true;
    }
    const item = card() === "menu" && button & BTN.SQUARE ? selectedItem() : undefined;
    if (pinnable(item)) {
      togglePin(item, allApps());
      return true;
    }
    return false;
  }
  var cardSink = () => ({
    text: cardText,
    key: cardKey,
    hint: cardHint
  });
  function cardHint() {
    switch (card()) {
      case "menu":
        return pinnable(selectedItem()) ? "type to filter · Enter opens · Y pins to Home" : "type to filter · ↑↓ move · Enter opens · Esc closes";
      case "panel":
        return "↑↓ move · ←→ adjust · Enter acts · Esc closes";
      case "picker":
        return "↑↓ preview · Enter applies · Esc cancels";
      default:
        return "";
    }
  }
  function cardTouch(frame) {
    switch (card()) {
      case "picker":
        return pickerTouch(frame);
      case "panel":
        return panelTouch(frame);
      case "menu":
        return menuTouch(frame);
    }
  }
  function closeCard() {
    switch (card()) {
      case "picker":
        return pickerKey("Escape");
      case "panel":
        return closePanel();
      case "menu":
        return closeMenu();
    }
  }
  var onCard = (x, y) => card() !== null && x >= CARD_X && x < CARD_X + CARD_W && y >= CARD_Y && y < CARD_Y + CARD_H;
  function Card() {
    let frame;
    let dim;
    const [content, setContent] = createSignal(null);
    createEffect(on(card, (kind) => {
      if (kind)
        setContent(kind);
      glide(dim, "opacity", kind ? 1 : 0, 140);
      glide(frame, "opacity", kind ? 1 : 0, kind ? 150 : 110);
      glide(frame, "translateY", kind ? 0 : 10, 170);
    }, {
      defer: true
    }));
    return [createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] h-[384]",
      get style() {
        return {
          bgColor: color("background", 0.45),
          opacity: 0
        };
      },
      ref: (n) => dim = n
    }), createComponent2(View, {
      class: "absolute overflow-hidden rounded-md",
      get style() {
        return {
          insetL: CARD_X - 2,
          insetT: CARD_Y - 2,
          width: CARD_W + 4,
          height: CARD_H + 4,
          bgColor: color("accent"),
          opacity: 0,
          translateY: 10
        };
      },
      ref: (n) => frame = n,
      get children() {
        return createComponent2(View, {
          class: "absolute left-[2] top-[2] overflow-hidden rounded-sm",
          get style() {
            return {
              width: CARD_W,
              height: CARD_H,
              bgColor: color("darker_background")
            };
          },
          get children() {
            return [createComponent2(View, {
              get ["class"]() {
                return C.card;
              },
              get style() {
                return {
                  opacity: content() === "menu" ? 1 : 0
                };
              },
              get children() {
                return createComponent2(MenuCard, {});
              }
            }), createComponent2(Show, {
              get when() {
                return content() === "panel";
              },
              get children() {
                return createComponent2(Panels, {});
              }
            }), createComponent2(Show, {
              get when() {
                return content() === "picker";
              },
              get children() {
                return createComponent2(Picker, {});
              }
            })];
          }
        });
      }
    })];
  }

  // shell/src/focus.ts
  function keySink() {
    const field2 = field();
    if (field2)
      return field2;
    if (card())
      return cardSink();
    const w = focused2();
    if (!w)
      return NO_SINK;
    if (w.kind === "terminal")
      return terminalSink;
    if (w.kind === "app")
      return appletTyping(w.app) ? appletKeys(w.app) : NO_SINK;
    const applet = appletOf(w);
    if (!applet)
      return NO_SINK;
    const own = applet.keys?.();
    if (own)
      return own;
    return {
      text: (ch) => ch === " " && applet.press?.(KEY_BUTTONS[" "]),
      key: (name) => {
        const button = KEY_BUTTONS[name];
        if (button)
          applet.press?.(button);
      },
      hint: applet.hint
    };
  }
  var rule = createMemo(() => {
    if (field())
      return "keys";
    if (card())
      return "keys";
    const w = focused2();
    if (!w)
      return "home";
    return w.kind === "app" ? appletTyping(w.app) ? "keys" : "pad" : "keys";
  });
  var [chosen, setChosen] = createSignal(null);
  createRoot(() => createEffect(on(rule, () => setChosen(null), {
    defer: true
  })));
  var layout2 = () => chosen() ?? rule();
  createRoot(() => createEffect(on([layout2, current4], ([l, ws]) => {
    if (watching())
      console.log(`deck: layout ${l}, workspace ${ws + 1}`);
  }, {
    defer: true
  })));
  function chooseLayout(next) {
    setChosen(next === rule() ? null : next);
  }
  function toggleKeys() {
    chooseLayout(layout2() === "keys" ? "pad" : "keys");
  }
  function toggleHome() {
    if (layout2() !== "home")
      return chooseLayout("home");
    chooseLayout(rule() === "home" ? "keys" : rule());
  }
  var ORDER = ["keys", "pad", "home"];
  function cycleLayout() {
    chooseLayout(ORDER[(ORDER.indexOf(layout2()) + 1) % ORDER.length]);
  }

  // shell/src/deck/press.ts
  var LINGER = 5;
  var [lit, setLit] = createSignal(null);
  var linger = 0;
  var pressed = (target) => lit() === target;
  function pressAt(target) {
    if (target !== null) {
      linger = LINGER;
      if (lit() !== target)
        setLit(target);
    } else if (lit() !== null && --linger <= 0)
      setLit(null);
  }

  // shell/src/deck/home.tsx
  var MAP_SCALE = 0.7;
  var MAP_W = STAGE_W * MAP_SCALE;
  var MAP_H = STAGE_H * MAP_SCALE;
  var MAP_X = (512 - MAP_W) / 2;
  var MAP_Y = 28;
  var SIDE_W = 60;
  var LEFT_X2 = (MAP_X - SIDE_W) / 2;
  var RIGHT_X2 = 512 - MAP_X + (MAP_X - SIDE_W) / 2;
  var CELL_H2 = 40;
  var CELL_GAP = 6;
  var LAYOUT_Y = MAP_Y + WORKSPACES * (CELL_H2 + CELL_GAP);
  var PANEL_LIST = ["tailscale", "proxy", "bluetooth", "network", "audio", "power"];
  var cellAt = (y) => {
    const i = Math.floor((y - MAP_Y) / (CELL_H2 + CELL_GAP));
    return y >= MAP_Y && y - MAP_Y - i * (CELL_H2 + CELL_GAP) < CELL_H2 ? i : -1;
  };
  var wsTabAt = (x, y) => {
    const i = x >= LEFT_X2 && x < LEFT_X2 + SIDE_W ? cellAt(y) : -1;
    return i < WORKSPACES ? i : -1;
  };
  var onBadge = (x, y) => x >= LEFT_X2 && x < LEFT_X2 + SIDE_W && y >= LAYOUT_Y && y < LAYOUT_Y + CELL_H2;
  var panels = () => PANEL_LIST.filter((p) => (p !== "proxy" || state()?.proxy) && (p !== "tailscale" || state()?.tailscale));
  var panelAt = (x, y) => x >= RIGHT_X2 && x < RIGHT_X2 + SIDE_W ? panels()[cellAt(y)] : undefined;
  var panelGlyph = (p) => {
    const s = state();
    return p === "tailscale" ? "\uDB80\uDF18" : p === "proxy" ? "\uDB81\uDD82" : p === "power" ? batteryGlyph(s?.battery ?? null) : p === "audio" ? audioGlyph(s?.audio ?? null) : p === "network" ? networkGlyph(s?.network) : bluetoothGlyph(s?.bluetooth ?? null);
  };
  var PIN_GAP = 6;
  var PIN_W = (MAP_W - MAX_PINS * PIN_GAP) / (MAX_PINS + 1);
  var PIN_H = 40;
  var PIN_Y = MAP_Y + MAP_H + 7;
  var PIN_STEP = PIN_W + PIN_GAP;
  var ADD = "\uDB81\uDC15";
  var DONE = "\uDB80\uDD2C";
  var REMOVE = "\uDB80\uDD56";
  var pinned = () => {
    const apps = allApps();
    return pinIds(apps).flatMap((id) => apps.find((a) => a.id === id) ?? []);
  };
  var pinXs = () => {
    const n = pinned().length + 1;
    const left = 256 - ((n - 1) * PIN_STEP + PIN_W) / 2;
    return Array.from({
      length: n
    }, (_, i) => left + i * PIN_STEP);
  };
  var pinAt = (x, y) => y >= PIN_Y && y < PIN_Y + PIN_H ? pinXs().findIndex((left) => x >= left && x < left + PIN_W) : -1;
  var [editing2, setEditing2] = createSignal(false);
  var EDIT_PAD = 4;
  var APP_H = 33;
  var APP_W = (MAP_W - 2 * EDIT_PAD) / 2;
  var APP_ROWS = Math.floor((MAP_H - 2 * EDIT_PAD) / APP_H);
  var appList = createList(APP_H, MAP_Y + EDIT_PAD, APP_ROWS);
  var appRows2 = () => {
    const apps = allApps();
    return Array.from({
      length: Math.ceil(apps.length / 2)
    }, (_, i) => [apps[2 * i], apps[2 * i + 1]]);
  };
  var appAt = (x, y) => {
    if (!onMap(x, y) || y < MAP_Y + EDIT_PAD)
      return -1;
    const row = appList.first() + Math.floor((y - MAP_Y - EDIT_PAD) / APP_H);
    const i = 2 * row + (x >= MAP_X + EDIT_PAD + APP_W ? 1 : 0);
    return i < allApps().length ? i : -1;
  };
  var full = () => pinIds(allApps()).length >= MAX_PINS;
  function editPins(on) {
    if (on)
      appList.reset();
    setEditing2(on);
  }
  function toggleApp(item) {
    const apps = allApps();
    if (pinIds(apps).includes(item.id) || !full())
      togglePin(item, apps);
  }
  function openPin(item) {
    const open = item.applet ? find((w) => w.kind === "app" && w.path === item.applet) : null;
    if (open)
      return focusWindow(open.id);
    openItem(item);
  }
  var toStage = (x, y) => ({
    x: (x - MAP_X) / MAP_SCALE,
    y: (y - MAP_Y) / MAP_SCALE
  });
  var onMap = (x, y) => x >= MAP_X && x < MAP_X + MAP_W && y >= MAP_Y && y < MAP_Y + MAP_H;
  var onDeck = (r) => ({
    x: MAP_X + r.x * MAP_SCALE,
    y: MAP_Y + r.y * MAP_SCALE,
    w: r.w * MAP_SCALE,
    h: r.h * MAP_SCALE
  });
  var icon = (w) => w.kind === "terminal" ? "\uDB80\uDD8D" : w.kind === "app" ? "\uDB82\uDF8A" : appletOf(w)?.icon ?? "";
  var title = (w) => w.kind === "terminal" ? "Terminal" : w.kind === "app" ? w.title : appletOf(w)?.title ?? w.applet;
  function homeTarget(x, y) {
    const ws = wsTabAt(x, y);
    if (ws >= 0)
      return `home:ws${ws}`;
    if (onBadge(x, y))
      return "home:layout";
    const p = panelAt(x, y);
    if (p)
      return `home:${p}`;
    const pin = pinAt(x, y);
    if (pin >= 0)
      return `home:pin${pin}`;
    if (editing2()) {
      const app = appAt(x, y);
      return app >= 0 ? `home:app${app}` : null;
    }
    if (onMap(x, y)) {
      const at = toStage(x, y);
      const id = windowAt(at.x, at.y);
      if (id !== null)
        return `home:win${id}`;
    }
    return null;
  }
  function tap(x, y) {
    const ws = wsTabAt(x, y);
    if (ws >= 0)
      return focus(ws);
    if (onBadge(x, y))
      return perform("layout");
    const p = panelAt(x, y);
    if (p)
      return panel() === p ? closePanel() : showPanel(p);
    const pin = pinAt(x, y);
    if (pin >= 0) {
      const item = pinned()[pin];
      if (!item)
        return editPins(!editing2());
      return editing2() ? togglePin(item, allApps()) : openPin(item);
    }
    if (editing2())
      return;
    if (onMap(x, y)) {
      const at = toStage(x, y);
      const id = windowAt(at.x, at.y);
      if (id !== null)
        act((m) => m.focusWin(id));
    }
  }
  function homeTouch(frame) {
    const c = frame.down[0];
    pressAt(c && !c.moved ? homeTarget(c.x, c.y) : null);
    if (editing2()) {
      const listed = (t) => onMap(t.start.x, t.start.y);
      appList.touch({
        ...frame,
        down: frame.down.filter(listed),
        taps: []
      }, appRows2().length, () => {});
      for (const t of frame.taps) {
        const i = !t.moved && listed(t) ? appAt(t.x, t.y) : -1;
        if (i >= 0)
          toggleApp(allApps()[i]);
      }
    }
    for (const p of frame.presses)
      tap(p.x, p.y);
  }
  function Tile(props) {
    const rect = createMemo(() => onDeck(placements().find((p) => p.id === props.win.id)?.rect ?? {
      x: 0,
      y: 0,
      w: 0,
      h: 0
    }), undefined, {
      equals: sameRect
    });
    const hidden = () => placements().find((p) => p.id === props.win.id)?.hidden ?? true;
    const isFocused = () => focused2()?.id === props.win.id;
    const lit = () => pressed(`home:win${props.win.id}`);
    let node;
    createEffect(on(rect, (next, prev) => {
      if (!node)
        return;
      if (prev)
        flip(node, prev, next);
      else
        flip(node, {
          x: next.x + next.w * 0.065,
          y: next.y + next.h * 0.065,
          w: next.w * 0.87,
          h: next.h * 0.87
        }, next, 0, 1);
    }));
    onCleanup(() => node = undefined);
    return createComponent2(View, {
      class: "absolute overflow-hidden",
      get style() {
        return {
          insetL: rect().x - MAP_X,
          insetT: rect().y - MAP_Y,
          width: rect().w,
          height: rect().h,
          opacity: hidden() ? 0 : 1,
          bgColor: color(lit() ? "bright_foreground" : isFocused() ? "accent" : "muted"),
          ...TOP_LEFT
        };
      },
      ref: (n) => node = n,
      get children() {
        return createComponent2(View, {
          class: "absolute left-[2] top-[2] overflow-hidden",
          get style() {
            return {
              width: rect().w - 4,
              height: rect().h - 4,
              bgColor: color(isFocused() ? "lighter_background" : "background")
            };
          },
          get children() {
            return [createComponent2(Text, {
              class: "absolute left-0 text-center font-mono text-base leading-[20]",
              get style() {
                return {
                  insetT: rect().h / 2 - 22,
                  width: rect().w - 4,
                  textColor: color(isFocused() ? "accent" : "foreground")
                };
              },
              get children() {
                return icon(props.win);
              }
            }), createComponent2(Text, {
              class: "absolute left-0 h-[14] overflow-hidden text-center font-mono text-xs leading-[14]",
              get style() {
                return {
                  insetT: rect().h / 2,
                  width: rect().w - 4,
                  textColor: color(isFocused() ? "bright_foreground" : "dark_foreground")
                };
              },
              get children() {
                return title(props.win);
              }
            })];
          }
        });
      }
    });
  }
  function PinCell(props) {
    return createComponent2(View, {
      class: "absolute rounded-md",
      get style() {
        return {
          insetL: props.x,
          insetT: PIN_Y,
          width: PIN_W,
          height: PIN_H,
          bgColor: color(pressed(props.target) ? "selection" : "dark_background")
        };
      },
      get children() {
        return [createComponent2(Text, {
          class: "absolute left-0 text-center font-mono text-base leading-[18]",
          get style() {
            return {
              insetT: PIN_H / 2 - 9,
              insetL: -inkShift(props.icon, 16),
              width: PIN_W,
              textColor: color(props.tone === "dim" ? "dark_foreground" : props.tone === "accent" ? "accent" : "foreground")
            };
          },
          get children() {
            return props.icon;
          }
        }), createComponent2(Show, {
          get when() {
            return props.removable;
          },
          get children() {
            return createComponent2(Text, {
              class: "absolute top-[1] w-[12] text-center font-mono text-xs leading-[12]",
              get style() {
                return {
                  insetL: PIN_W - 13,
                  textColor: color("dark_foreground")
                };
              },
              children: REMOVE
            });
          }
        })];
      }
    });
  }
  function AppCell(props) {
    const on = () => pinIds(allApps()).includes(props.item.id);
    const tone = () => on() ? "accent" : full() ? "muted" : "foreground";
    return createComponent2(View, {
      class: "absolute top-[1] rounded-sm",
      get style() {
        return {
          insetL: props.x,
          width: APP_W - 2,
          height: APP_H - 2,
          bgColor: color(pressed(`home:app${props.index}`) ? "selection" : on() ? "background" : "dark_background")
        };
      },
      get children() {
        return [createComponent2(Text, {
          class: "absolute top-[7] w-[20] text-center font-mono text-base leading-[18]",
          get style() {
            return {
              insetL: 8 - inkShift(props.item.icon, 16),
              textColor: color(tone())
            };
          },
          get children() {
            return props.item.icon;
          }
        }), createComponent2(Text, {
          class: "absolute left-[34] top-[9] h-[14] overflow-hidden font-mono text-xs leading-[14]",
          get style() {
            return {
              width: APP_W - 60,
              textColor: color(on() ? "bright_foreground" : tone())
            };
          },
          get children() {
            return props.item.label;
          }
        }), createComponent2(Show, {
          get when() {
            return on();
          },
          get children() {
            return createComponent2(Text, {
              class: "absolute top-[8] w-[16] text-center font-mono text-xs leading-[16]",
              get style() {
                return {
                  insetL: APP_W - 24 - inkShift(PIN, 12),
                  textColor: color("accent")
                };
              },
              children: PIN
            });
          }
        })];
      }
    });
  }
  function AppList() {
    return createComponent2(View, {
      class: "absolute overflow-hidden rounded-sm",
      get style() {
        return {
          insetL: MAP_X,
          insetT: MAP_Y,
          width: MAP_W,
          height: MAP_H,
          bgColor: color("darker_background"),
          opacity: editing2() ? 1 : 0
        };
      },
      get children() {
        return createComponent2(List, {
          state: appList,
          items: appRows2,
          top: EDIT_PAD,
          rowH: APP_H,
          left: EDIT_PAD,
          width: MAP_W - 2 * EDIT_PAD,
          selected: () => -1,
          children: (row, i) => [createComponent2(AppCell, {
            get item() {
              return row()[0];
            },
            x: 0,
            index: 2 * i
          }), createComponent2(Show, {
            get when() {
              return row()[1];
            },
            children: (second) => createComponent2(AppCell, {
              get item() {
                return second();
              },
              x: APP_W,
              index: 2 * i + 1
            })
          })]
        });
      }
    });
  }
  function Home() {
    const bar = () => barPosition();
    createEffect(on(layout2, (l) => l === "home" ? refreshApps() : editPins(false), {
      defer: true
    }));
    return [createComponent2(View, {
      class: "absolute overflow-hidden rounded-sm",
      get style() {
        return {
          insetL: MAP_X,
          insetT: MAP_Y,
          width: MAP_W,
          height: MAP_H,
          bgColor: color("dark_background")
        };
      },
      get children() {
        return [createComponent2(Show, {
          get when() {
            return bar() !== "none";
          },
          get children() {
            return createComponent2(View, {
              class: "absolute left-0",
              get style() {
                return {
                  insetT: bar() === "bottom" ? MAP_H - BAR_H * MAP_SCALE : 0,
                  width: MAP_W,
                  height: BAR_H * MAP_SCALE,
                  bgColor: color("background")
                };
              }
            });
          }
        }), createComponent2(For, {
          get each() {
            return visibleWindows();
          },
          children: (win) => createComponent2(Tile, {
            win
          })
        }), createComponent2(Show, {
          get when() {
            return visibleWindows().length === 0;
          },
          get children() {
            return createComponent2(Text, {
              class: "absolute left-0 text-center font-mono text-xs leading-[14]",
              get style() {
                return {
                  insetT: MAP_H / 2 - 7,
                  width: MAP_W,
                  textColor: color("dark_foreground")
                };
              },
              children: "No windows"
            });
          }
        })];
      }
    }), createComponent2(AppList, {}), createComponent2(For, {
      get each() {
        return pinned();
      },
      children: (item, i) => createComponent2(PinCell, {
        get x() {
          return pinXs()[i()];
        },
        get icon() {
          return item.icon;
        },
        get target() {
          return `home:pin${i()}`;
        },
        get removable() {
          return editing2();
        }
      })
    }), createComponent2(PinCell, {
      get x() {
        return pinXs()[pinned().length];
      },
      get icon() {
        return editing2() ? DONE : ADD;
      },
      get target() {
        return `home:pin${pinned().length}`;
      },
      get tone() {
        return editing2() ? "accent" : "dim";
      }
    }), createComponent2(For, {
      get each() {
        return Array.from({
          length: WORKSPACES
        }, (_, i) => i);
      },
      children: (n) => createComponent2(View, {
        class: "absolute rounded-md",
        get style() {
          return {
            insetL: LEFT_X2,
            insetT: MAP_Y + n * (CELL_H2 + CELL_GAP),
            width: SIDE_W,
            height: CELL_H2,
            bgColor: color(current4() === n || pressed(`home:ws${n}`) ? "selection" : "dark_background")
          };
        },
        get children() {
          return createComponent2(Text, {
            class: "absolute left-0 text-center font-mono text-sm leading-[16]",
            get style() {
              return {
                insetT: CELL_H2 / 2 - 8,
                width: SIDE_W,
                textColor: color(current4() === n ? "accent" : occupied(n) ? "foreground" : "muted")
              };
            },
            get children() {
              return String(n + 1);
            }
          });
        }
      })
    }), createComponent2(View, {
      class: "absolute rounded-md",
      get style() {
        return {
          insetL: LEFT_X2,
          insetT: LAYOUT_Y,
          width: SIDE_W,
          height: CELL_H2,
          bgColor: color(pressed("home:layout") ? "selection" : "background")
        };
      },
      get children() {
        return createComponent2(Text, {
          class: "absolute left-0 text-center font-mono text-xs leading-[14]",
          get style() {
            return {
              insetT: CELL_H2 / 2 - 7,
              width: SIDE_W,
              textColor: color("dark_foreground")
            };
          },
          get children() {
            return layout() === "dwindle" ? "tile" : "scroll";
          }
        });
      }
    }), createComponent2(For, {
      get each() {
        return panels();
      },
      children: (p, i) => createComponent2(View, {
        class: "absolute rounded-md",
        get style() {
          return {
            insetL: RIGHT_X2,
            insetT: MAP_Y + i() * (CELL_H2 + CELL_GAP),
            width: SIDE_W,
            height: CELL_H2,
            bgColor: color(panel() === p || pressed(`home:${p}`) ? "selection" : "dark_background")
          };
        },
        get children() {
          return createComponent2(Text, {
            class: "absolute left-0 text-center font-mono text-base leading-[18]",
            get style() {
              return {
                insetT: CELL_H2 / 2 - 9,
                insetL: -inkShift(panelGlyph(p), 16),
                width: SIDE_W,
                textColor: color(panel() === p ? "accent" : p === "proxy" && state()?.proxy?.running === false || p === "tailscale" && state()?.tailscale?.state !== "Running" ? "muted" : "foreground")
              };
            },
            get children() {
              return panelGlyph(p);
            }
          });
        }
      })
    })];
  }

  // vendor/pocketjs/contracts/spec/ime.ts
  var IME = Object.freeze({
    keys: 128,
    candidates: 5,
    select: 16777216,
    selectAbsolute: 33554432,
    browseSize: 15,
    browseLimit: 512,
    backspace: 65288,
    enter: 65293,
    left: 65361,
    right: 65363,
    pageUp: 65365,
    pageDown: 65366
  });

  // shell/src/term/ime.ts
  var [chinese, setChinese] = createSignal(false);
  var [snapshot, setSnapshot] = createSignal(null);
  var keys = [];
  var [typed, setTyped] = createSignal(0);
  var revision2 = 0;
  var waiting = false;
  var queued = [];
  var composing = () => typed() > 0 || snapshot() !== null;
  function setKeys(next) {
    keys = next;
    setTyped(next.length);
  }
  function toggleChinese() {
    reset2();
    setChinese((on) => !on);
  }
  function reset2() {
    setKeys([]);
    revision2++;
    waiting = false;
    queued.length = 0;
    setSnapshot(null);
  }
  var NAMED = {
    Backspace: IME.backspace,
    Enter: IME.enter,
    Left: IME.left,
    Right: IME.right,
    PageUp: IME.pageUp,
    PageDown: IME.pageDown
  };
  var commits = (code) => code === 32 || code === IME.enter || code >= 48 && code <= 57 || code >= IME.select && code < IME.select + 5 || /[^a-z]/.test(String.fromCharCode(code));
  function evaluate2(emit) {
    const mine = ++revision2;
    request({
      method: "ime",
      keys: [...keys]
    }).then((next) => {
      if (mine !== revision2)
        return;
      if (next.commit)
        emit(next.commit);
      if (next.commit || !next.raw) {
        setKeys([]);
        setSnapshot(next.preedit ? next : null);
      } else
        setSnapshot(next);
      waiting = false;
      const pending = queued.splice(0);
      for (const q of pending)
        route(q.key, q.emit, q.pass);
    }, () => {
      if (mine === revision2)
        reset2();
    });
  }
  function route(key, emit, pass) {
    if (!chinese())
      return pass();
    if (waiting)
      return void queued.push({
        key,
        emit,
        pass
      });
    const active = keys.length > 0;
    let code;
    if ([...key].length === 1) {
      const c = key.charCodeAt(0);
      if (c >= 32 && c <= 126 && (/[a-z]/.test(key) || (active ? true : /[,.;:?!'"()<>[\]\\]/.test(key))))
        code = c;
    } else if (active && key === "Escape")
      return reset2();
    else if (active)
      code = NAMED[key];
    if (code === undefined)
      return active ? undefined : pass();
    setKeys([...keys, code]);
    if (keys.length > IME.keys)
      return reset2();
    if (commits(code))
      waiting = true;
    evaluate2(emit);
  }
  function pick(index, emit) {
    if (!keys.length || waiting)
      return;
    setKeys([...keys, IME.select + index]);
    waiting = true;
    evaluate2(emit);
  }

  // shell/src/stick.ts
  var DEAD = 0.35;
  var SLOW = 14;
  var FAST = 4;
  var wait = [0, 0];
  var remote = {
    x: 0,
    y: 0,
    frames: 0
  };
  function holdStick(x, y, frames) {
    Object.assign(remote, {
      x,
      y,
      frames
    });
  }
  function read2() {
    if (remote.frames > 0) {
      remote.frames--;
      return [remote.x, remote.y];
    }
    const left = [analogX(), analogY()];
    const right = [rightAnalogX(), rightAnalogY()];
    return Math.hypot(...left) >= Math.hypot(...right) ? left : right;
  }
  function step(axis, push) {
    if (Math.abs(push) < DEAD)
      return void (wait[axis] = 0);
    if (wait[axis] > 0)
      return void wait[axis]--;
    act((m) => m.resizeAxis(axis === 0 ? "x" : "y", Math.sign(push)));
    wait[axis] = Math.round(SLOW + (FAST - SLOW) * ((Math.abs(push) - DEAD) / (1 - DEAD)));
  }
  function stickTick(active) {
    const [x, y] = active ? read2() : [0, 0];
    step(0, x);
    step(1, y);
  }

  // shell/src/clock-format.ts
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS2 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var TOKEN = /'[^']*'|dddd|ddd|dd|d|MMMM|MMM|MM|M|yyyy|yy|HH|H|hh|h|mm|m|ss|s|AP|ap|ww|w/g;
  var two2 = (n) => n < 10 ? `0${n}` : String(n);
  function week(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7);
  }
  function formatClock(format, date) {
    const h12 = date.getHours() % 12 || 12;
    return format.replace(TOKEN, (t) => {
      switch (t) {
        case "dddd":
          return DAYS[date.getDay()];
        case "ddd":
          return DAYS[date.getDay()].slice(0, 3);
        case "dd":
          return two2(date.getDate());
        case "d":
          return String(date.getDate());
        case "MMMM":
          return MONTHS2[date.getMonth()];
        case "MMM":
          return MONTHS2[date.getMonth()].slice(0, 3);
        case "MM":
          return two2(date.getMonth() + 1);
        case "M":
          return String(date.getMonth() + 1);
        case "yyyy":
          return String(date.getFullYear());
        case "yy":
          return two2(date.getFullYear() % 100);
        case "HH":
          return two2(date.getHours());
        case "H":
          return String(date.getHours());
        case "hh":
          return two2(h12);
        case "h":
          return String(h12);
        case "mm":
          return two2(date.getMinutes());
        case "m":
          return String(date.getMinutes());
        case "ss":
          return two2(date.getSeconds());
        case "s":
          return String(date.getSeconds());
        case "AP":
          return date.getHours() < 12 ? "AM" : "PM";
        case "ap":
          return date.getHours() < 12 ? "am" : "pm";
        case "ww":
          return two2(week(date));
        case "w":
          return String(week(date));
        default:
          return t.slice(1, -1);
      }
    });
  }

  // shell/src/stage/bar.tsx
  var NUMBERS = Array.from({
    length: WORKSPACES
  }, (_, i) => i);
  var SLOT = 20;
  var H2 = 18;
  var ALPHA = {
    opaque: 1,
    glassy: 0.75,
    none: 0
  };
  var marker;
  createRoot(() => createEffect(on(current4, (ws) => glide(marker, "translateX", ws * 14, 160), {
    defer: true
  })));
  function barIndicators(s) {
    return [{
      name: "power",
      glyph: batteryGlyph(s?.battery ?? null)
    }, {
      name: "audio",
      glyph: audioGlyph(s?.audio ?? null)
    }, {
      name: "network",
      glyph: networkGlyph(s?.network)
    }, {
      name: "bluetooth",
      glyph: bluetoothGlyph(s?.bluetooth ?? null)
    }, {
      name: "proxy",
      glyph: s?.proxy ? "\uDB81\uDD82" : "",
      off: s?.proxy?.running === false
    }, {
      name: "tailscale",
      glyph: s?.tailscale ? "\uDB80\uDF18" : "",
      off: s?.tailscale ? s.tailscale.state !== "Running" : false
    }].filter((i) => i.glyph);
  }
  function Bar(props) {
    const settings = () => state()?.bar;
    const clock = () => formatClock(settings()?.clock ?? "dddd HH:mm", props.now());
    const top = () => settings()?.position === "bottom" ? 384 - H2 : 0;
    const indicators = () => barIndicators(state());
    const statusRight = () => 512 - 8 - SLOT * indicators().length - 8;
    return createComponent2(Show, {
      get when() {
        return !settings()?.hidden;
      },
      get children() {
        return createComponent2(View, {
          get ["class"]() {
            return C.bar;
          },
          get style() {
            return {
              insetT: top(),
              bgColor: color("background", ALPHA[settings()?.background ?? "opaque"] ?? 1)
            };
          },
          get children() {
            return [createComponent2(Text, {
              get ["class"]() {
                return C.barText;
              },
              get style() {
                return {
                  insetL: 6,
                  insetT: 4,
                  textColor: color("foreground")
                };
              },
              children: ""
            }), createComponent2(View, {
              class: "absolute top-[2] h-[14] w-[12] rounded-sm",
              get style() {
                return {
                  insetL: 23.5,
                  translateX: untrack(current4) * 14,
                  bgColor: color("bright_foreground")
                };
              },
              ref: (n) => marker = n
            }), createComponent2(For, {
              each: NUMBERS,
              children: (n) => createComponent2(Text, {
                get ["class"]() {
                  return C.barText;
                },
                get style() {
                  return {
                    insetL: 26 + n * 14,
                    insetT: 2.5,
                    textColor: color(current4() === n ? "background" : occupied(n) ? "foreground" : "muted")
                  };
                },
                get children() {
                  return String(n + 1);
                }
              })
            }), createComponent2(Text, {
              get ["class"]() {
                return C.barCenter;
              },
              get style() {
                return {
                  textColor: color("foreground")
                };
              },
              get children() {
                return clock();
              }
            }), createComponent2(Text, {
              class: "absolute top-[2] text-right font-mono text-xs leading-[14]",
              get style() {
                return {
                  insetL: statusRight() - 160,
                  width: 160,
                  opacity: held() === "plain" ? 1 : 0,
                  textColor: color("dark_foreground")
                };
              },
              get children() {
                return layout();
              }
            }), createComponent2(For, {
              each: HELD_LAYERS,
              children: (l) => createComponent2(Text, {
                class: "absolute top-[2] text-right font-mono text-xs leading-[14]",
                get style() {
                  return {
                    insetL: statusRight() - 160,
                    width: 160,
                    opacity: held() === l ? 1 : 0,
                    textColor: color("accent")
                  };
                },
                get children() {
                  return LAYER_TITLE[l];
                }
              })
            }), createComponent2(For, {
              get each() {
                return indicators();
              },
              children: (i, n) => createComponent2(Text, {
                get ["class"]() {
                  return C.barText;
                },
                get style() {
                  return {
                    insetL: 512 - 8 - SLOT * (n() + 1) + 4,
                    textColor: color(props.focused() === i.name ? "accent" : ("off" in i) && i.off ? "muted" : "foreground")
                  };
                },
                get children() {
                  return i.glyph;
                }
              })
            })];
          }
        });
      }
    });
  }

  // vendor/pocket-term/shared/protocol.ts
  var BOX_DRAWING = "─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋╌╍╎╏═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰╱╲╳╴╵╶╷╸╹╺╻╼╽╾╿";
  var BLOCK_ELEMENTS = "▀▁▂▃▄▅▆▇█▉▊▋▌▍▎▏▐░▒▓▔▕▖▗▘▙▚▛▜▝▞▟";
  var TERM_SYMBOLS = "■□▪▫▲►▼◄◆●○∙·•‾¬½¼«»≈≠≤≥±÷×→←↑↓↔⏻…—–‘’“”➜❯❮✗λ";
  var TERM_GLYPHS = `${BOX_DRAWING}${BLOCK_ELEMENTS}${TERM_SYMBOLS}`;
  function runColumns(run) {
    return run[5] ?? run[1].length;
  }

  // shell/src/term/grid.tsx
  var CELL_W = 6.4;
  var TRACK = CELL_W - 7.2;
  var CELL_H3 = 14;
  var PAD = 3;
  var hex = (rgb) => "#" + rgb.toString(16).padStart(6, "0");
  function WideRun(props) {
    const chars = () => [...props.run[1]];
    const step = () => runColumns(props.run) / Math.max(1, chars().length);
    return [createComponent2(Show, {
      get when() {
        return props.run[3] >= 0;
      },
      get children() {
        return createComponent2(View, {
          class: "absolute top-0",
          get style() {
            return {
              insetL: props.run[0] * CELL_W,
              width: runColumns(props.run) * CELL_W,
              height: CELL_H3,
              bgColor: hex(props.run[3])
            };
          }
        });
      }
    }), createComponent2(For, {
      get each() {
        return chars();
      },
      children: (ch, i) => createComponent2(Text, {
        class: "absolute top-0 font-mono text-xs",
        get style() {
          return {
            insetL: (props.run[0] + i() * step()) * CELL_W,
            lineHeight: CELL_H3,
            fontSlot: props.run[4],
            textColor: props.run[2] >= 0 ? hex(props.run[2]) : color("foreground")
          };
        },
        children: ch
      })
    })];
  }
  function RunView(props) {
    return createComponent2(Show, {
      get when() {
        return props.run()[4] === undefined;
      },
      get fallback() {
        return createComponent2(WideRun, {
          get run() {
            return props.run();
          }
        });
      },
      get children() {
        return [createComponent2(Show, {
          get when() {
            return props.run()[3] >= 0;
          },
          get children() {
            return createComponent2(View, {
              class: "absolute top-0",
              get style() {
                return {
                  insetL: props.run()[0] * CELL_W,
                  width: runColumns(props.run()) * CELL_W,
                  height: CELL_H3,
                  bgColor: hex(props.run()[3])
                };
              }
            });
          }
        }), createComponent2(Text, {
          class: "absolute top-0 font-mono text-xs",
          get style() {
            return {
              insetL: props.run()[0] * CELL_W,
              lineHeight: CELL_H3,
              tracking: TRACK,
              textColor: props.run()[2] >= 0 ? hex(props.run()[2]) : color("foreground")
            };
          },
          get children() {
            return props.run()[1];
          }
        })];
      }
    });
  }
  function TermGrid(props) {
    const cols = () => Math.max(8, Math.min(TERM_COLS, Math.floor((props.w - 2 * PAD) / CELL_W)));
    const rows = () => Math.max(2, Math.min(TERM_ROWS, Math.floor((props.h - 2 * PAD) / CELL_H3)));
    let settle = 0;
    createEffect(on([cols, rows], ([c, r]) => {
      const mine = ++settle;
      after(0.25, () => mine === settle && resizeTerminal(props.sid, c, r));
    }));
    return createComponent2(Show, {
      get when() {
        return sessionById(props.sid);
      },
      keyed: true,
      children: (s) => createComponent2(View, {
        class: "absolute overflow-hidden",
        get style() {
          return {
            insetL: PAD,
            insetT: PAD,
            width: props.w - 2 * PAD,
            height: props.h - 2 * PAD
          };
        },
        get children() {
          return [createComponent2(Show, {
            get when() {
              return memo2(() => s.cursor()[2] === 1)() && s.cursor()[1] < rows();
            },
            get children() {
              return createComponent2(View, {
                class: "absolute",
                get style() {
                  return {
                    insetL: s.cursor()[0] * CELL_W,
                    insetT: s.cursor()[1] * CELL_H3,
                    width: CELL_W,
                    height: CELL_H3,
                    bgColor: color("accent", 0.6)
                  };
                }
              });
            }
          }), createComponent2(Index, {
            get each() {
              return s.rows.slice(0, rows());
            },
            children: (row, y) => createComponent2(View, {
              class: "absolute left-0",
              get style() {
                return {
                  insetT: y * CELL_H3,
                  width: cols() * CELL_W,
                  height: CELL_H3
                };
              },
              get children() {
                return createComponent2(Index, {
                  get each() {
                    return row()();
                  },
                  children: (run) => createComponent2(RunView, {
                    run
                  })
                });
              }
            })
          })];
        }
      })
    });
  }

  // shell/src/stage/windows.tsx
  var HEADER_H4 = 16;
  var NO_RECT = {
    x: 0,
    y: 0,
    w: 0,
    h: 0
  };
  var windowTitle = (w) => w.kind === "terminal" ? sessionById(w.sid)?.title() || "Terminal" : w.kind === "app" ? w.title : appletOf(w)?.title ?? w.applet;
  var SETTLE_S = 0.3;
  function AppView(props) {
    let node;
    const texture = () => appTextures(props.app)?.[props.applet ? 1 : 0];
    createEffect(() => {
      const t = texture();
      if (node && t !== undefined)
        getOps().setImage(node.id, t);
    });
    const fit = createMemo(() => props.applet ? fitSurface(props.w, props.h) : null, undefined, {
      equals: (a, b) => a === b || !!a && !!b && a.w === b.w && a.h === b.h && a.scale === b.scale
    });
    if (props.applet) {
      let generation = 0;
      createEffect(() => {
        const next = fit();
        const mine = ++generation;
        if (appletFit(props.app) === undefined)
          return sizeApplet(props.app, next);
        after(SETTLE_S, () => mine === generation && sizeApplet(props.app, next));
      });
    }
    const surface = () => (props.applet ? appletFit(props.app) : null) ?? (props.applet ? null : {
      w: 512,
      h: 384,
      scale: 1
    });
    const drawn = () => {
      const s = surface();
      if (!s)
        return {
          x: 0,
          y: 0,
          w: 0,
          h: 0
        };
      const k = Math.min(props.w / s.w, props.h / s.h, props.applet ? 1 : Infinity);
      return {
        x: (props.w - s.w * k) / 2,
        y: (props.h - s.h * k) / 2,
        w: s.w * k,
        h: s.h * k
      };
    };
    return [createComponent2(Image, {
      ref: (n) => node = n,
      class: "absolute",
      src: "wall-0-0.png",
      get style() {
        return {
          insetL: drawn().x,
          insetT: drawn().y,
          width: drawn().w,
          height: drawn().h,
          scaleY: -1,
          opacity: texture() === undefined || !surface() ? 0 : 1
        };
      }
    }), createComponent2(Show, {
      get when() {
        return memo2(() => !!props.applet)() && appletRefused(props.app);
      },
      get children() {
        return [createComponent2(Text, {
          class: "absolute left-0 text-center text-xl leading-[24]",
          get style() {
            return {
              insetT: props.h / 2 - 30,
              width: props.w,
              textColor: color("dark_foreground")
            };
          },
          children: "\uDB82\uDF8A"
        }), createComponent2(Text, {
          class: "absolute left-0 h-[16] overflow-hidden text-center font-mono text-xs leading-[16]",
          get style() {
            return {
              insetT: props.h / 2,
              width: props.w,
              textColor: color("foreground")
            };
          },
          get children() {
            return props.title;
          }
        }), createComponent2(Text, {
          class: "absolute left-0 h-[14] overflow-hidden text-center font-mono text-xs leading-[14]",
          get style() {
            return {
              insetT: props.h / 2 + 18,
              width: props.w,
              textColor: color("dark_foreground")
            };
          },
          children: "needs a bigger tile"
        })];
      }
    }), createComponent2(Show, {
      get when() {
        return memo2(() => texture() === undefined)() && !(props.applet && appletRefused(props.app));
      },
      get children() {
        return createComponent2(Text, {
          class: "absolute left-0 h-[16] overflow-hidden text-center font-mono text-sm leading-[16]",
          get style() {
            return {
              insetT: props.h / 2 - 8,
              width: props.w,
              textColor: color("dark_foreground")
            };
          },
          get children() {
            return `starting ${props.title}`;
          }
        });
      }
    })];
  }
  function Frame(props) {
    const rect = createMemo(() => placements().find((p) => p.id === props.win.id)?.rect ?? NO_RECT, NO_RECT, {
      equals: sameRect
    });
    const isFocused = createMemo(() => focused2()?.id === props.win.id);
    const contentW = createMemo(() => Math.max(0, rect().w - 2 * BORDER));
    const contentH = createMemo(() => Math.max(0, rect().h - 2 * BORDER - HEADER_H4));
    const applet = appletOf(props.win);
    return createComponent2(View, {
      class: "absolute overflow-hidden rounded-md contain-strict",
      get style() {
        return {
          insetL: rect().x,
          insetT: rect().y,
          width: rect().w,
          height: rect().h,
          bgColor: color(isFocused() ? "accent" : "muted"),
          ...WINDOW_ORIGIN
        };
      },
      ref: (node) => onCleanup(bindWindow(props.win.id, node)),
      get children() {
        return [createComponent2(View, {
          class: "absolute overflow-hidden rounded-md",
          get style() {
            return {
              insetL: BORDER,
              insetT: BORDER,
              width: contentW(),
              height: rect().h - 2 * BORDER,
              bgColor: color("background")
            };
          },
          get children() {
            return [createComponent2(View, {
              class: "absolute left-0 top-0",
              get style() {
                return {
                  width: contentW(),
                  height: HEADER_H4,
                  bgColor: color(isFocused() ? "lighter_background" : "dark_background")
                };
              },
              get children() {
                return createComponent2(Text, {
                  class: "absolute left-[6] top-[1] h-[14] overflow-hidden font-mono text-xs leading-[14]",
                  get style() {
                    return {
                      width: contentW() - 12,
                      textColor: color(isFocused() ? "bright_foreground" : "dark_foreground")
                    };
                  },
                  get children() {
                    return windowTitle(props.win);
                  }
                });
              }
            }), createComponent2(View, {
              class: "absolute left-0 overflow-hidden contain-strict",
              get style() {
                return {
                  insetT: HEADER_H4,
                  width: contentW(),
                  height: contentH()
                };
              },
              get children() {
                return memo2(() => props.win.kind === "terminal")() ? createComponent2(TermGrid, {
                  get sid() {
                    return props.win.sid;
                  },
                  get w() {
                    return contentW();
                  },
                  get h() {
                    return contentH();
                  }
                }) : memo2(() => props.win.kind === "app")() ? createComponent2(AppView, {
                  get app() {
                    return props.win.app;
                  },
                  get title() {
                    return props.win.title;
                  },
                  get applet() {
                    return props.win.appletSurface;
                  },
                  get w() {
                    return contentW();
                  },
                  get h() {
                    return contentH();
                  }
                }) : applet ? createComponent2(applet.Stage, {
                  get w() {
                    return contentW();
                  },
                  get h() {
                    return contentH();
                  },
                  get focused() {
                    return isFocused();
                  }
                }) : null;
              }
            })];
          }
        }), createComponent2(For, {
          each: CORNERS,
          children: (corner) => createComponent2(View, {
            class: "absolute",
            get style() {
              return {
                insetL: corner.left ? 0 : rect().w - 2 * RADIUS,
                insetT: corner.top ? 0 : rect().h - 2 * RADIUS,
                width: 2 * RADIUS,
                height: 2 * RADIUS,
                arcStart: corner.start,
                arcSweep: 90,
                arcWidth: BORDER,
                bgColor: color(isFocused() ? "accent" : "muted")
              };
            }
          })
        })];
      }
    });
  }
  var RADIUS = 6;
  var CORNERS = [{
    left: true,
    top: true,
    start: 270
  }, {
    left: false,
    top: true,
    start: 0
  }, {
    left: false,
    top: false,
    start: 90
  }, {
    left: true,
    top: false,
    start: 180
  }];
  function Windows() {
    return [createComponent2(For, {
      get each() {
        return visibleWindows();
      },
      children: (win) => createComponent2(Frame, {
        win
      })
    }), createComponent2(For, {
      get each() {
        return ghosts();
      },
      children: (ghost) => createComponent2(View, {
        class: "absolute rounded-md",
        get style() {
          return {
            insetL: ghost.rect.x,
            insetT: ghost.rect.y,
            width: ghost.rect.w,
            height: ghost.rect.h,
            bgColor: color("muted", 0.9)
          };
        },
        ref: (node) => bindGhost(node),
        get children() {
          return createComponent2(View, {
            class: "absolute rounded-md",
            get style() {
              return {
                insetL: BORDER,
                insetT: BORDER,
                width: ghost.rect.w - 2 * BORDER,
                height: ghost.rect.h - 2 * BORDER,
                bgColor: color("background", 0.9)
              };
            }
          });
        }
      })
    })];
  }

  // shell/src/stage/pointer.tsx
  var BAR_H2 = 18;
  var x = 256;
  var y = 192;
  var node;
  var pointer = () => ({
    x,
    y
  });
  function surfaceOf(id) {
    const win = id === null ? null : windowById(id);
    if (!win || win.kind !== "app" || !win.appletSurface)
      return null;
    const rect = placements().find((p) => p.id === id)?.rect;
    const fit = appletFit(win.app);
    if (!rect || !fit)
      return null;
    const cw = rect.w - 2 * BORDER;
    const ch = rect.h - 2 * BORDER - HEADER_H4;
    const k = Math.min(cw / fit.w, ch / fit.h, 1);
    return {
      app: win.app,
      ox: rect.x + BORDER + (cw - fit.w * k) / 2,
      oy: rect.y + BORDER + HEADER_H4 + (ch - fit.h * k) / 2,
      k,
      w: fit.w,
      h: fit.h
    };
  }
  function surfaceOfApp(app) {
    const at = placements().find((p) => {
      const w = windowById(p.id);
      return w?.kind === "app" && w.app === app;
    });
    return at ? surfaceOf(at.id) : null;
  }
  function appletPoint(px, py) {
    const s = surfaceOf(windowAt(px, py));
    if (!s)
      return null;
    const sx = (px - s.ox) / s.k;
    const sy = (py - s.oy) / s.k;
    return sx >= 0 && sx < s.w && sy >= 0 && sy < s.h ? {
      app: s.app,
      x: sx,
      y: sy
    } : null;
  }
  var SLOT2 = 20;
  function barClick(px) {
    for (let n = 0;n < WORKSPACES; n++)
      if (px >= 22 + n * 14 && px < 36 + n * 14)
        return focus(n);
    const indicators = barIndicators(state());
    const at = Math.floor((512 - 8 - px) / SLOT2);
    if (px < 512 - 8 && at >= 0 && at < indicators.length)
      showPanel(indicators[at].name);
  }
  var touch = null;
  function movePointer(dx, dy) {
    const nx = Math.max(0, Math.min(511, x + dx));
    const ny = Math.max(0, Math.min(383, y + dy));
    if (touch?.held && touch.follow) {
      touch.at.x += nx - x;
      touch.at.y += ny - y;
    }
    x = nx;
    y = ny;
    place(node, "translateX", x);
    place(node, "translateY", y);
  }
  function scrollBy(dx, dy) {
    if (touch?.held && !touch.follow) {
      touch.at.x += dx;
      touch.at.y += dy;
    }
  }
  var PINCH_SLOP = 1.15;
  var SPREAD = 80;
  var spread2 = 0;
  function pinchTo(ratio) {
    if (!touch?.held || touch.follow)
      return;
    if (spread2 === 0 && ratio < PINCH_SLOP && ratio > 1 / PINCH_SLOP)
      return;
    spread2 = Math.max(12, Math.min(360, SPREAD * ratio));
  }
  function click() {
    if (card()) {
      if (!onCard(x, y))
        return closeCard();
      const at = {
        id: 1,
        x: x - CARD_X,
        y: y - CARD_Y,
        frames: 2,
        start: {
          x: x - CARD_X,
          y: y - CARD_Y
        },
        dx: 0,
        dy: 0,
        moved: false
      };
      return cardTouch({
        raw: 0,
        down: [],
        presses: [],
        taps: [at]
      });
    }
    const top = state()?.bar?.position === "bottom" ? 384 - BAR_H2 : 0;
    if (!state()?.bar?.hidden && y >= top && y < top + BAR_H2)
      return barClick(x);
    const id = windowAt(x, y);
    if (id === null)
      return;
    focusWindow(id);
    const target = appletPoint(x, y);
    if (target)
      touch = {
        app: target.app,
        frames: 3,
        held: false,
        follow: false,
        at: {
          x,
          y
        }
      };
  }
  function hold(down, follow = true) {
    spread2 = 0;
    if (!down) {
      if (touch?.held)
        touch = null;
      return;
    }
    const id = windowAt(x, y);
    if (id !== null)
      focusWindow(id);
    const target = appletPoint(x, y);
    touch = target ? {
      app: target.app,
      frames: 0,
      held: true,
      follow,
      at: {
        x,
        y
      }
    } : null;
  }
  function pointerContacts(app) {
    if (!touch || touch.app !== app)
      return [];
    if (!touch.held && --touch.frames < 0) {
      touch = null;
      return [];
    }
    const s = surfaceOfApp(app);
    if (!s)
      return [];
    const sx = Math.max(0, Math.min(s.w - 1, (touch.at.x - s.ox) / s.k));
    const sy = Math.max(0, Math.min(s.h - 1, (touch.at.y - s.oy) / s.k));
    if (spread2 > 0 && touch.held)
      return [1, sx, sy, 2, Math.max(0, Math.min(s.w - 1, sx + spread2 / s.k)), sy];
    return [1, sx, sy];
  }
  function Pointer(props) {
    createEffect(on(props.shown, (shown) => glide(node, "opacity", shown ? 1 : 0, 140), {
      defer: true
    }));
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[20] h-[24]",
      style: {
        translateX: x,
        translateY: y,
        opacity: 0
      },
      ref: (n) => node = n,
      get children() {
        return [createComponent2(Text, {
          class: "absolute left-[-3] top-[-2] text-xl leading-[24]",
          get style() {
            return {
              textColor: color("background")
            };
          },
          children: "\uDB80\uDDC0"
        }), createComponent2(Text, {
          class: "absolute left-[-3] top-[-2] text-xl leading-[24]",
          get style() {
            return {
              textColor: color("bright_foreground")
            };
          },
          children: "\uDB80\uDDBF"
        })];
      }
    });
  }

  // shell/src/remote-input.ts
  var held2 = [];
  var taps = [];
  var TAP_FRAMES = 3;
  serve("pocket.input", {
    hold: (name, frames = "2") => {
      const mask = BTN[name ?? ""];
      if (!mask)
        throw new Error(`no button ${name}`);
      held2.push({
        mask,
        frames: Math.max(1, Number(frames) || 2)
      });
      return "ok";
    },
    tap: (x, y) => (taps.push({
      x: Number(x),
      y: Number(y),
      frames: TAP_FRAMES + 1
    }), "ok"),
    stick: (x, y, frames = "30") => (holdStick(Math.max(-1, Math.min(1, Number(x) || 0)), Math.max(-1, Math.min(1, Number(y) || 0)), Math.max(1, Number(frames) || 30)), "ok"),
    pointer: (x, y) => (movePointer(Number(x) - pointer().x, Number(y) - pointer().y), "ok"),
    click: () => (click(), "ok"),
    drag: (x, y, x2, y2, frames = "20", hold = "0") => {
      const total = Math.max(4, Number(frames) || 20);
      const still = Math.max(0, Number(hold) || 0);
      taps.push({
        x: Number(x),
        y: Number(y),
        x2: Number(x2),
        y2: Number(y2),
        frames: still + total + 1,
        total,
        hold: still
      });
      return "ok";
    },
    drag2: (x, y, x2, y2, frames = "20", apart = "80") => {
      const total = Math.max(4, Number(frames) || 20);
      taps.push({
        x: Number(x),
        y: Number(y),
        x2: Number(x2),
        y2: Number(y2),
        frames: total + 1,
        total,
        hold: 0,
        apart: Number(apart) || 80
      });
      return "ok";
    },
    type: (text) => {
      for (const ch of text ?? "")
        sendKey(ch);
      return "ok";
    },
    key: (name) => (sendKey(name ?? ""), "ok"),
    layout: (name) => {
      if (name !== "keys" && name !== "pad" && name !== "home")
        throw new Error(`no layout ${name}`);
      chooseLayout(name);
      return "ok";
    },
    watch: (frames = "120") => {
      watchFor(Math.max(1, Number(frames) || 120));
      return "ok";
    }
  });
  function watchTouches(contacts) {
    if (!watchTick())
      return;
    if (contacts.length)
      console.log(`touch ${contacts.map((c) => `${c.id}@${c.x.toFixed(0)},${c.y.toFixed(0)}`).join(" ")}`);
  }
  function remoteButtons() {
    let mask = 0;
    for (const h of held2)
      if (h.frames-- > 0)
        mask |= h.mask;
    for (let i = held2.length - 1;i >= 0; i--)
      if (held2[i].frames <= 0)
        held2.splice(i, 1);
    return mask;
  }
  function remoteContacts() {
    const tap = taps[0];
    if (!tap)
      return [];
    tap.frames--;
    if (tap.frames <= 0) {
      taps.shift();
      return [];
    }
    if (tap.total === undefined)
      return [tap];
    const t = Math.max(0, Math.min(1, (tap.total - tap.frames) / (tap.total - 1)));
    const at = {
      x: tap.x + (tap.x2 - tap.x) * t,
      y: tap.y + (tap.y2 - tap.y) * t
    };
    return tap.apart ? [at, {
      x: at.x + tap.apart,
      y: at.y
    }] : [at];
  }

  // shell/src/term/keyboard.tsx
  var BACKSPACE = "\uDB80\uDC6E";
  var ENTER = "\uDB80\uDF11";
  var chars2 = (row, shifted = row.toUpperCase(), w) => [...row].map((ch, i) => ({
    label: ch,
    key: ch,
    shifted: shifted[i],
    w
  }));
  var backspace = {
    label: BACKSPACE,
    key: "Backspace",
    w: 1.5,
    repeat: true
  };
  var enter = {
    label: ENTER,
    key: "Enter",
    w: 1.45
  };
  var ARROW = 0.95;
  var bottom = (layer) => [layer === "abc" ? {
    label: "123",
    key: "",
    w: 1.2,
    layer: "123"
  } : {
    label: "ABC",
    key: "",
    w: 1.2,
    layer: "abc"
  }, {
    label: "EN",
    key: "",
    w: 0.9,
    ime: true
  }, {
    label: "Ctrl",
    key: "",
    modifier: "ctrl"
  }, {
    label: "Alt",
    key: "",
    modifier: "alt"
  }, {
    label: "",
    key: " ",
    w: 2.3
  }, {
    label: ".",
    key: ".",
    w: 0.75
  }, {
    label: "←",
    key: "Left",
    w: ARROW,
    repeat: true
  }, {
    label: "↑",
    key: "Up",
    w: ARROW,
    repeat: true,
    half: "up"
  }, {
    label: "↓",
    key: "Down",
    w: ARROW,
    repeat: true,
    half: "down"
  }, {
    label: "→",
    key: "Right",
    w: ARROW,
    repeat: true
  }];
  var SHORT = 0.95;
  var LAYERS = {
    abc: {
      rows: [chars2("qwertyuiop"), [...chars2("asdfghjkl", undefined, SHORT), enter], [{
        label: "⇧",
        key: "",
        w: 1.5,
        modifier: "shift"
      }, ...chars2("zxcvbnm"), backspace], bottom("abc")],
      inset: [0, 0, 0, 0]
    },
    "123": {
      rows: [chars2("1234567890", "1234567890"), [...chars2("-/:;()$&@", "-/:;()$&@", SHORT), enter], [{
        label: "#+=",
        key: "",
        w: 1.5,
        layer: "sym"
      }, ...chars2(`.,?!'"`, `.,?!'"`, 7 / 6), backspace], bottom("123")],
      inset: [0, 0, 0, 0]
    },
    sym: {
      rows: [chars2("[]{}#%^*+=", "[]{}#%^*+="), [...chars2("_\\|~<>`¥£", "_\\|~<>`¥£", SHORT), enter], [{
        label: "123",
        key: "",
        w: 1.5,
        layer: "123"
      }, ...chars2(".,?!'•", ".,?!'•", 7 / 6), backspace], bottom("sym")],
      inset: [0, 0, 0, 0]
    }
  };
  var UNIT = 512 / 10;
  var GAP2 = 5;
  var FULL_PITCH = 46;
  var EDGE = 6;
  var REPEAT_AFTER = 24;
  var REPEAT_EVERY = 4;
  var REPEAT_MAX = 40;
  var CHORD_S = 1.4;
  var placeRow = (row, inset, y, h) => {
    let x = inset * UNIT;
    return row.map((key) => {
      const w = (key.w ?? 1) * UNIT;
      const [lit, setLit] = createSignal(false);
      const half = key.half ? h / 2 : h;
      const p = {
        ...key,
        x,
        y: key.half === "down" ? y + half : y,
        w,
        h: half,
        char: [...key.key].length === 1 && key.key !== " ",
        lit,
        setLit
      };
      if (key.half !== "up")
        x += w;
      return p;
    });
  };
  function layoutFor(mode, layer) {
    const rows = LAYERS[layer].rows;
    const pitch = mode === "full" ? FULL_PITCH : KEY_PITCH;
    const top = mode === "full" ? 384 - EDGE - rows.length * FULL_PITCH : KEYS_TOP;
    const keys = rows.flatMap((row, r) => placeRow(row, LAYERS[layer].inset[r], top + r * pitch, pitch));
    return {
      keys,
      top,
      bottom: mode === "full" ? 384 : KEYS_BOTTOM
    };
  }
  var LAYOUTS = new Map;
  var layout3 = (mode, layer) => {
    const id = `${mode}:${layer}`;
    let l = LAYOUTS.get(id);
    if (!l)
      LAYOUTS.set(id, l = layoutFor(mode, layer));
    return l;
  };
  var [mods, setMods] = createSignal({
    shift: false,
    ctrl: false,
    alt: false
  });
  var [capsLock, setCapsLock] = createSignal(false);
  var [layer2, setLayer] = createSignal("abc");
  var pressed2 = [];
  var [chord, setChord] = createSignal("");
  var lastShift = -1;
  var frameCount = 0;
  function latch(modifier) {
    if (modifier === "shift") {
      if (capsLock()) {
        setCapsLock(false);
        setMods((m) => ({
          ...m,
          shift: false
        }));
        return;
      }
      if (frameCount - lastShift < 20) {
        setCapsLock(true);
        return;
      }
      lastShift = frameCount;
    }
    setMods((m) => ({
      ...m,
      [modifier]: !m[modifier]
    }));
  }
  function resetKeyboard() {
    setMods({
      shift: false,
      ctrl: false,
      alt: false
    });
    setCapsLock(false);
    setLayer("abc");
  }
  function showChord(name) {
    setChord(name);
    after(CHORD_S, () => setChord(""));
  }
  var typedHook = () => {};
  var onTyped = (hook) => typedHook = hook;
  var typed2 = () => typedHook();
  var chordName = (m, name) => `${m.ctrl ? "^" : ""}${m.alt ? "M-" : ""}${name.length === 1 ? name.toUpperCase() : name}`;
  function sendKey(key, shifted) {
    const m = mods();
    const shift = m.shift || capsLock();
    setMods({
      shift: false,
      ctrl: false,
      alt: false
    });
    const name = shift && shifted ? shifted : key;
    if (m.ctrl || m.alt)
      showChord(chordName(m, name));
    typed2();
    const sink = keySink();
    const direct = () => {
      if ([...key].length === 1 && !m.ctrl && !m.alt)
        sink.text(name);
      else
        sink.key(name, {
          ctrl: m.ctrl,
          alt: m.alt,
          shift: shift && !shifted
        });
    };
    if (m.ctrl || m.alt || sink.field)
      return direct();
    route(name, (text) => sink.text(text), direct);
  }
  function sendCtrl(ch) {
    showChord(chordName({
      ctrl: true,
      alt: false
    }, ch));
    typed2();
    keySink().key(ch, {
      ctrl: true,
      alt: false,
      shift: false
    });
  }
  var keyAt = (keys, x, y) => keys.find((k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h) ?? null;
  function press(key) {
    if (watching())
      console.log(`key ${key.label} press`);
    if (key.modifier)
      latch(key.modifier);
    else if (key.layer)
      setLayer(key.layer);
    else if (key.ime)
      toggleChinese();
    else
      sendKey(key.key, key.shifted);
  }
  var held3 = new Map;
  function keyboardTouch(frame, mode) {
    frameCount++;
    const {
      keys,
      top,
      bottom: edge
    } = layout3(mode, layer2());
    const onKeys = (c) => c.start.y >= top && c.start.y < edge;
    const down = frame.down.filter(onKeys);
    const now = down.map((c) => keyAt(keys, c.x, c.y)).filter((k) => k !== null);
    for (const k of pressed2)
      if (!now.includes(k)) {
        k.setLit(false);
        if (watching())
          console.log(`key ${k.label} unlit`);
      }
    for (const k of now)
      if (!pressed2.includes(k)) {
        k.setLit(true);
        if (watching())
          console.log(`key ${k.label} lit`);
      }
    pressed2 = now;
    for (const c of frame.presses) {
      if (!onKeys(c))
        continue;
      const key = keyAt(keys, c.x, c.y);
      if (!key)
        continue;
      press(key);
      if (key.repeat)
        held3.set(c.id, {
          frames: 0,
          repeats: 0
        });
    }
    for (const c of down) {
      const h = held3.get(c.id);
      if (!h)
        continue;
      h.frames++;
      const key = keyAt(keys, c.x, c.y);
      if (key?.repeat && h.repeats < REPEAT_MAX && h.frames > REPEAT_AFTER && (h.frames - REPEAT_AFTER) % REPEAT_EVERY === 0) {
        h.repeats++;
        press(key);
      }
    }
    for (const t of frame.taps)
      held3.delete(t.id);
  }
  function Keyboard(props) {
    const current = () => layout3(props.mode, layer2());
    const latched = (k) => !!k.modifier && mods()[k.modifier] || k.modifier === "shift" && capsLock();
    const small = (k) => !!k.half || k.modifier === "ctrl" || k.modifier === "alt" || !!k.layer || !!k.ime;
    const fnKey = (k) => !k.char && k.key !== " ";
    const label = (k) => {
      if (k.ime)
        return chinese() ? "中" : "EN";
      if (k.modifier === "shift" && capsLock())
        return "⇪";
      return (mods().shift || capsLock()) && k.shifted ? k.shifted : k.label;
    };
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] contain-strict",
      get style() {
        return {
          height: props.mode === "full" ? 384 : KEYS_BOTTOM + 2
        };
      },
      get children() {
        return [createComponent2(Show, {
          get when() {
            return memo2(() => props.mode === "full")() && keySink().field;
          },
          children: (field) => createComponent2(Text, {
            class: "absolute left-0 w-[512] text-center text-lg leading-[24]",
            get style() {
              return {
                insetT: current().top / 2 - 22,
                textColor: color("bright_foreground")
              };
            },
            get children() {
              return field()();
            }
          })
        }), createComponent2(Show, {
          get when() {
            return props.mode === "full";
          },
          get children() {
            return createComponent2(Text, {
              class: "absolute left-0 w-[512] text-center font-mono text-xs leading-[14]",
              get style() {
                return {
                  insetT: current().top / 2 + 10,
                  textColor: color("dark_foreground")
                };
              },
              get children() {
                return keySink().hint?.() ?? "";
              }
            });
          }
        }), createComponent2(For, {
          get each() {
            return current().keys;
          },
          children: (k) => createComponent2(View, {
            class: "absolute rounded-md",
            get style() {
              return {
                insetL: k.x + GAP2 / 2,
                insetT: k.y + GAP2 / 2,
                width: k.w - GAP2,
                height: k.h - GAP2,
                bgColor: color(k.lit() ? "accent" : latched(k) ? "selection" : fnKey(k) ? "dark_background" : "background")
              };
            },
            get children() {
              return createComponent2(Text, {
                get ["class"]() {
                  return small(k) ? "absolute left-0 text-center font-mono text-xs leading-[14]" : "absolute left-0 text-center font-mono text-base leading-[18]";
                },
                get style() {
                  return {
                    width: k.w - GAP2,
                    insetT: (k.h - GAP2) / 2 - (small(k) ? 7 : 9),
                    textColor: color(k.lit() ? "background" : latched(k) || k.ime && chinese() ? "accent" : fnKey(k) ? "foreground" : "bright_foreground"),
                    ...k.ime && chinese() ? cjk("中", CJK_SLOT_14) : {}
                  };
                },
                get children() {
                  return label(k);
                }
              });
            }
          })
        })];
      }
    });
  }

  // shell/src/deck/strip.tsx
  var LOGO = "";
  var HOME = "\uDB80\uDEDC";
  var CLOSE = "\uDB80\uDD56";
  var LEFT = "\uDB80\uDD41";
  var EDGE2 = 4;
  var GAP3 = 4;
  var CHIP_H = 28;
  var CHIP_Y = 3;
  var LOGO_W = 36;
  var ESC_W = 44;
  var END_W = 40;
  var MAX_W2 = 84;
  var PREEDIT_W = 132;
  var CANDIDATE_W = (512 - PREEDIT_W) / 5;
  var ctrl = (ch) => ({
    id: `ctrl-${ch}`,
    label: `^${ch.toUpperCase()}`,
    run: () => sendCtrl(ch)
  });
  var TAB = {
    id: "tab",
    label: "Tab",
    run: () => sendKey("Tab")
  };
  function pinChip() {
    const item = menuOpen() ? selectedItem() : undefined;
    if (!pinnable(item))
      return [];
    const on = pinIds(allApps()).includes(item.id);
    return [{
      id: "pin",
      label: on ? "Unpin" : "Pin",
      glyph: on ? UNPIN : PIN,
      run: () => togglePin(item, allApps())
    }];
  }
  function context() {
    if (field())
      return [];
    if (card())
      return [...pinChip(), TAB];
    const w = focused2();
    if (!w)
      return [{
        id: "layout",
        label: "Layout",
        run: () => perform("layout")
      }];
    if (w.kind === "terminal")
      return [TAB, ctrl("c"), ctrl("d"), ctrl("l"), ctrl("r")];
    if (w.kind === "app" && !appletTyping(w.app))
      return [{
        id: "back",
        label: "Back",
        glyph: LEFT,
        run: pressBack
      }];
    return [TAB];
  }
  var closes = () => keySink().close;
  var row2 = createRoot(() => createMemo(() => {
    const close = closes();
    const start = [{
      id: "menu",
      label: "",
      glyph: LOGO,
      run: toggleMenu,
      lit: menuOpen
    }, {
      id: "esc",
      label: "Esc",
      run: () => sendKey("Escape")
    }];
    const end = [...close ? [{
      id: "close",
      label: "",
      glyph: CLOSE,
      run: () => keySink().close?.(),
      danger: true
    }] : [], {
      id: "home",
      label: "",
      glyph: HOME,
      run: toggleHome,
      lit: () => layout2() === "home"
    }];
    const middle = context();
    const ends = LOGO_W + ESC_W + end.length * END_W;
    const room = 512 - 2 * EDGE2 - ends - (2 + middle.length + end.length - 1) * GAP3;
    const w = middle.length ? Math.min(MAX_W2, Math.floor(room / middle.length)) : 0;
    let x = EDGE2;
    const place = (chip, width) => {
      const placed = {
        ...chip,
        x,
        w: width
      };
      x += width + GAP3;
      return placed;
    };
    const out = [place(start[0], LOGO_W), place(start[1], ESC_W), ...middle.map((c) => place(c, w))];
    x = 512 - EDGE2 - end.length * END_W - (end.length - 1) * GAP3;
    return [...out, ...end.map((c) => place(c, END_W))];
  }));
  var chipAt = (x) => row2().find((c) => x >= c.x - GAP3 / 2 && x < c.x + c.w + GAP3 / 2);
  function stripTarget(x) {
    if (composing())
      return null;
    const chip = chipAt(x);
    return chip ? `strip:${chip.id}` : null;
  }
  function stripTouch(frame) {
    for (const c of frame.presses) {
      if (composing()) {
        if (c.x >= PREEDIT_W)
          pick(Math.floor((c.x - PREEDIT_W) / CANDIDATE_W), (text) => keySink().text(text));
        continue;
      }
      chipAt(c.x)?.run();
    }
  }
  function Strip() {
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] contain-strict",
      style: {
        height: STRIP_H
      },
      get children() {
        return createComponent2(Show, {
          get when() {
            return composing();
          },
          get fallback() {
            return createComponent2(For, {
              get each() {
                return row2();
              },
              children: (chip) => {
                const lit = () => chip.lit?.() === true;
                return createComponent2(View, {
                  class: "absolute rounded-md",
                  get style() {
                    return {
                      insetL: chip.x,
                      insetT: CHIP_Y,
                      width: chip.w,
                      height: CHIP_H,
                      bgColor: color(lit() || pressed(`strip:${chip.id}`) ? "selection" : "dark_background")
                    };
                  },
                  get children() {
                    return [createComponent2(Show, {
                      get when() {
                        return memo2(() => !!chip.glyph)() && chip.label;
                      },
                      get children() {
                        return createComponent2(Text, {
                          class: "absolute top-[6] w-[16] text-center font-mono text-xs leading-[16]",
                          get style() {
                            return {
                              insetL: 6 - inkShift(chip.glyph, 12),
                              textColor: color("foreground")
                            };
                          },
                          get children() {
                            return chip.glyph;
                          }
                        });
                      }
                    }), createComponent2(Text, {
                      get ["class"]() {
                        return chip.id === "menu" ? "absolute left-0 top-[8] h-[16] overflow-hidden text-center font-mono text-sm leading-[16]" : "absolute left-0 top-[6] h-[16] overflow-hidden text-center font-mono text-xs leading-[16]";
                      },
                      get style() {
                        return {
                          width: chip.w,
                          insetL: chip.glyph && chip.label ? 11 : chip.label ? 0 : -inkShift(chip.glyph ?? "", chip.id === "menu" ? 14 : 12),
                          textColor: color(chip.danger ? "red" : lit() ? "accent" : "foreground")
                        };
                      },
                      get children() {
                        return chip.label || chip.glyph;
                      }
                    })];
                  }
                });
              }
            });
          },
          get children() {
            return createComponent2(View, {
              class: "absolute left-0 top-0 w-[512]",
              get style() {
                return {
                  height: STRIP_H,
                  bgColor: color("dark_background")
                };
              },
              get children() {
                return [createComponent2(Text, {
                  class: "absolute left-[10] top-[8] h-[18] overflow-hidden font-mono text-sm leading-[18]",
                  get style() {
                    return {
                      width: PREEDIT_W - 14,
                      textColor: color("accent"),
                      ...cjk(snapshot()?.preedit ?? "", CJK_SLOT_14)
                    };
                  },
                  get children() {
                    return snapshot()?.preedit ?? "";
                  }
                }), createComponent2(For, {
                  get each() {
                    return snapshot()?.candidates ?? [];
                  },
                  children: (candidate, i) => createComponent2(Text, {
                    class: "absolute top-[8] h-[18] overflow-hidden text-center font-mono text-sm leading-[18]",
                    get style() {
                      return {
                        insetL: PREEDIT_W + i() * CANDIDATE_W,
                        width: CANDIDATE_W - 4,
                        textColor: color(i() === 0 ? "bright_foreground" : "foreground"),
                        ...cjk(candidate, CJK_SLOT_14)
                      };
                    },
                    children: candidate
                  })
                })];
              }
            });
          }
        });
      }
    });
  }

  // shell/src/deck/voice.ts
  var [state2, setState2] = createSignal("idle");
  var [level2, setLevel] = createSignal(0);
  var voiceState = state2;
  var voiceLevel = level2;
  var MIC = "\uDB80\uDF6C";
  var say2 = (title, body = "") => toast({
    icon: MIC,
    title,
    body,
    tone: "info"
  }, 2.4);
  function deliver(text) {
    if (!text)
      return say2("Nothing heard");
    const sink = keySink();
    if (sink === NO_SINK)
      return say2("Nothing takes text here", text);
    sink.text(text);
  }
  var failed = (error) => {
    setState2("idle");
    toast({
      icon: MIC,
      title: "Voice input",
      body: error instanceof Error ? error.message : String(error),
      tone: "error"
    }, 3);
  };
  function toggleVoice() {
    const now = state2();
    if (now === "decoding")
      return;
    if (now === "listening") {
      setState2("decoding");
      return void request({
        method: "voiceStop"
      }).then(deliver, failed);
    }
    setState2("listening");
    request({
      method: "voiceStart"
    }).catch(failed);
  }
  onEvent((event) => {
    if (event.event === "voice") {
      setState2(event.state);
      setLevel(event.level);
    } else if (event.event === "voiceText")
      deliver(event.text);
  });

  // shell/src/touch.ts
  var SETTLE = 2;
  var SLOP = 10;
  var live = new Map;
  var REMOTE = 1000;
  function trackTouches() {
    const now = new Map;
    const contacts = auxiliaryTouches();
    watchTouches(contacts);
    for (const c of contacts)
      now.set(c.id, {
        x: c.x,
        y: c.y
      });
    remoteContacts().forEach((p, i) => now.set(REMOTE + i, p));
    const taps = [];
    const presses = [];
    for (const [id, t] of live) {
      if (now.has(id))
        continue;
      live.delete(id);
      if (t.frames >= SETTLE)
        taps.push({
          ...t,
          dx: 0,
          dy: 0
        });
    }
    for (const [id, p] of now) {
      const t = live.get(id);
      if (t) {
        t.dx = p.x - t.x;
        t.dy = p.y - t.y;
        t.x = p.x;
        t.y = p.y;
        t.frames++;
        t.moved ||= Math.abs(p.x - t.start.x) > SLOP || Math.abs(p.y - t.start.y) > SLOP;
        if (t.frames === SETTLE)
          presses.push({
            ...t
          });
      } else
        live.set(id, {
          id,
          x: p.x,
          y: p.y,
          dx: 0,
          dy: 0,
          moved: false,
          frames: 1,
          start: {
            ...p
          }
        });
    }
    const down = [...live.values()].map((c) => ({
      ...c
    }));
    return {
      raw: now.size,
      down,
      presses,
      taps
    };
  }
  var settled = (c) => c.frames >= SETTLE;
  function band(frame, top, bottom) {
    const inside = (c) => c.start.y >= top && c.start.y < bottom;
    const shift = (c) => ({
      ...c,
      y: c.y - top,
      start: {
        x: c.start.x,
        y: c.start.y - top
      }
    });
    return {
      raw: frame.raw,
      down: frame.down.filter(inside).map(shift),
      presses: frame.presses.filter(inside).map(shift),
      taps: frame.taps.filter(inside).map(shift)
    };
  }

  // shell/src/deck/touchpad.tsx
  var padFor = (l) => l === "keys" ? PAD_SMALL : PAD_LARGE;
  var ROUND_LIST = [{
    name: "voice",
    glyph: "\uDB80\uDF6C"
  }, {
    name: "hold",
    glyph: "\uDB80\uDDBE"
  }, {
    name: "toggle",
    glyph: "\uDB80\uDF0C"
  }, {
    name: "close",
    glyph: "\uDB80\uDD56"
  }];
  var roundAt = (x, y) => ROUND_LIST.find((r) => inRect(ROUNDS[r.name], x, y))?.name;
  function closeFront() {
    if (sheetOpen())
      return closeSheet();
    if (card())
      return closeCard();
    closeFocused();
  }
  function roundTarget(x, y) {
    const name = roundAt(x, y);
    return name ? `round:${name}` : null;
  }
  var GAIN = 1.1;
  var ACCEL = 0.09;
  var MAX_GAIN = 3.2;
  var [mode2, setMode2] = createSignal(null);
  var [awake, setAwake] = createSignal(false);
  var pointerAwake = awake;
  onTyped(() => setAwake(false));
  var surfacePackage = () => {
    const w = focused2();
    return w?.kind === "app" && w.aux && !w.appletSurface ? w : null;
  };
  var SECOND_FRAMES = 5;
  var SECOND_APART = 40;
  var primary = null;
  var dragged = false;
  var scrolled = false;
  var waiting2 = {
    dx: 0,
    dy: 0
  };
  var span = 0;
  function move3(dx, dy) {
    const speed = Math.hypot(dx, dy);
    const gain = Math.min(MAX_GAIN, GAIN + speed * ACCEL);
    if (speed > 0)
      movePointer(dx * gain, dy * gain);
  }
  function touchpadTouch(frame) {
    const l = layout2();
    if (l === "pad" && surfacePackage()) {
      const contacts = [];
      for (const c of frame.down) {
        const x = (c.x - SURFACE_X) / SCALE;
        const y = c.y / SCALE;
        if (x >= 0 && x < 512 && y >= 0 && y < 384)
          contacts.push(c.id, x, y);
      }
      return contacts;
    }
    for (const c of frame.presses) {
      const name = roundAt(c.x, c.y);
      if (name === "toggle")
        toggleKeys();
      else if (name === "voice")
        toggleVoice();
      else if (name === "close")
        closeFront();
    }
    const rect = padFor(l);
    const inPad = (x, y) => !keySink().field && inRect(rect, x, y);
    const onKey = (x, y) => inRect(ROUNDS.hold, x, y);
    const down = frame.down.filter(settled);
    const keyDown = down.some((c) => onKey(c.start.x, c.start.y));
    const pad = down.filter((c) => inPad(c.start.x, c.start.y));
    if (pad.length && !awake())
      setAwake(true);
    for (const t of frame.taps)
      if (t.id === primary && !t.moved && !dragged && inPad(t.start.x, t.start.y))
        click();
    const first = pad[0];
    if (!first) {
      primary = null;
      dragged = scrolled = false;
    } else if (first.id !== primary) {
      primary = first.id;
      dragged = false;
    }
    const others = first ? pad.filter((c) => c.id !== first.id) : [];
    const second = others.find((c) => c.frames >= SECOND_FRAMES && Math.hypot(c.x - first.x, c.y - first.y) >= SECOND_APART);
    const next = keyDown ? "drag" : second ? "scroll" : null;
    if (next !== mode2()) {
      if (mode2())
        hold(false);
      if (next)
        hold(true, next === "drag");
      setMode2(next);
    }
    if (next)
      dragged = true;
    if (next === "scroll")
      scrolled = true;
    if (next !== "scroll")
      span = 0;
    if (first) {
      if (next === "scroll") {
        scrollBy((first.dx + second.dx) / 2 + waiting2.dx, (first.dy + second.dy) / 2 + waiting2.dy);
        waiting2.dx = waiting2.dy = 0;
        const apart = Math.hypot(second.x - first.x, second.y - first.y);
        if (span === 0)
          span = apart;
        pinchTo(apart / span);
      } else if (others.length && !keyDown) {
        waiting2.dx += first.dx;
        waiting2.dy += first.dy;
      } else {
        if (!scrolled)
          move3(first.dx + waiting2.dx, first.dy + waiting2.dy);
        waiting2.dx = waiting2.dy = 0;
      }
    } else
      waiting2.dx = waiting2.dy = 0;
    return [];
  }
  var SCALE = Math.min(512 / 512, BODY_H / 384);
  var SURFACE_W = 512 * SCALE;
  var SURFACE_H = 384 * SCALE;
  var SURFACE_X = (512 - SURFACE_W) / 2;
  function Surface(props) {
    let node;
    const texture = () => appTextures(props.win.app)?.[1];
    createEffect(() => {
      const t = texture();
      if (node && t !== undefined)
        getOps().setImage(node.id, t);
    });
    return createComponent2(Image, {
      ref: (n) => node = n,
      class: "absolute top-0",
      src: "wall-0-0.png",
      get style() {
        return {
          insetL: SURFACE_X,
          width: SURFACE_W,
          height: SURFACE_H,
          scaleY: -1,
          opacity: texture() === undefined ? 0 : 1
        };
      }
    });
  }
  function Touchpad() {
    return createComponent2(View, {
      get ["class"]() {
        return C.deck;
      },
      get children() {
        return createComponent2(Show, {
          get when() {
            return memo2(() => layout2() === "pad")() && surfacePackage();
          },
          keyed: true,
          get fallback() {
            return createComponent2(Pad, {});
          },
          children: (w) => createComponent2(Surface, {
            win: w
          })
        });
      }
    });
  }
  var line = () => {
    const voice = voiceState();
    if (voice === "listening")
      return "listening · press the microphone to finish";
    if (voice === "decoding")
      return "turning that into text";
    const sent = chord();
    if (sent)
      return `sent ${sent}`;
    return keySink().hint?.() ?? (layout2() === "pad" ? "tap to click · two fingers scroll or pinch" : "");
  };
  function Pad() {
    let node;
    const rect = () => padFor(layout2() === "keys" ? "keys" : "pad");
    createEffect(on(rect, (next, prev) => node && prev && prev !== next && flip(node, prev, next, 1, 1, 180), {
      defer: false
    }));
    const field = () => keySink().field;
    return [createComponent2(View, {
      class: "absolute rounded-lg",
      get style() {
        return {
          insetL: rect().x,
          insetT: rect().y,
          width: rect().w,
          height: rect().h,
          bgColor: color(mode2() ? "selection" : "dark_background"),
          ...TOP_LEFT
        };
      },
      ref: (n) => node = n
    }), createComponent2(Show, {
      get when() {
        return field();
      },
      get fallback() {
        return createComponent2(Text, {
          class: "absolute h-[28] overflow-hidden text-center font-mono text-xs leading-[14]",
          get style() {
            return {
              insetL: rect().x + 12,
              insetT: rect().y + rect().h - 34,
              width: rect().w - 24,
              textColor: color(voiceState() !== "idle" || chord() ? "accent" : "muted")
            };
          },
          get children() {
            return line();
          }
        });
      },
      children: (value) => [createComponent2(Text, {
        class: "absolute text-center text-lg leading-[24]",
        get style() {
          return {
            insetL: rect().x,
            insetT: rect().y + rect().h / 2 - 26,
            width: rect().w,
            textColor: color("bright_foreground")
          };
        },
        get children() {
          return value()();
        }
      }), createComponent2(Text, {
        class: "absolute h-[14] overflow-hidden text-center font-mono text-xs leading-[14]",
        get style() {
          return {
            insetL: rect().x + 8,
            insetT: rect().y + rect().h / 2 + 6,
            width: rect().w - 16,
            textColor: color("dark_foreground")
          };
        },
        get children() {
          return keySink().hint?.() ?? "";
        }
      })]
    }), createComponent2(For, {
      each: ROUND_LIST,
      children: (r) => {
        const listening = () => r.name === "voice" && voiceState() === "listening";
        const lit = () => r.name === "voice" ? voiceState() === "decoding" : r.name === "hold" ? mode2() === "drag" : r.name === "toggle" ? layout2() === "keys" : false;
        const at = ROUNDS[r.name];
        return createComponent2(View, {
          class: "absolute w-[44] h-[44] rounded-full",
          get style() {
            return {
              insetL: at.x,
              insetT: at.y,
              bgColor: color(listening() ? "red" : pressed(`round:${r.name}`) ? "selection" : "dark_background"),
              opacity: listening() ? 0.55 + 0.45 * voiceLevel() : 1
            };
          },
          get children() {
            return createComponent2(Text, {
              class: "absolute left-0 text-center text-xl leading-[24]",
              get style() {
                return {
                  insetT: ROUND / 2 - 12,
                  insetL: -inkShift(r.glyph, 20),
                  width: ROUND,
                  textColor: color(listening() ? "bright_foreground" : lit() ? "accent" : "foreground")
                };
              },
              get children() {
                return r.glyph;
              }
            });
          }
        });
      }
    })];
  }

  // shell/src/stage/lock.tsx
  var LOCK2 = "\uDB80\uDF3E";
  var [locked, setLocked] = createSignal(false);
  var [password, setPassword] = createSignal("");
  var [status2, setStatus2] = createSignal("");
  function verify() {
    const attempt = password();
    setPassword("");
    setStatus2("Checking...");
    request({
      method: "checkPassword",
      password: attempt
    }).then((ok) => {
      if (!ok)
        return setStatus2("Wrong password");
      setLocked(false);
      setStatus2("");
      setFieldSink(null);
    }, (error) => setStatus2(String(error)));
  }
  function lock() {
    if (locked())
      return;
    setLocked(true);
    setPassword("");
    setStatus2("");
    setFieldSink({
      text: (ch) => setPassword((p) => p + ch),
      key: (name) => {
        if (name === "Enter")
          verify();
        else if (name === "Backspace")
          setPassword((p) => [...p].slice(0, -1).join(""));
        else if (name === "Escape")
          setPassword("");
      },
      field: () => `${LOCK2} ${status2() || "Password"}: ${"•".repeat([...password()].length)}_`,
      hint: () => "A Enter · B Backspace · START clears"
    });
  }
  serve("lock", {
    lock: () => (lock(), "locked"),
    isLocked: () => String(locked()),
    status: () => locked() ? "locked" : "unlocked"
  });
  onEvent((event) => {
    if (event.event === "sleep")
      lock();
  });
  function LockStage(props) {
    return createComponent2(Show, {
      get when() {
        return locked();
      },
      get children() {
        return createComponent2(View, {
          get ["class"]() {
            return C.cover;
          },
          get style() {
            return {
              bgColor: color("background", 0.85)
            };
          },
          get children() {
            return [createComponent2(Text, {
              get ["class"]() {
                return C.lockIcon;
              },
              get style() {
                return {
                  textColor: color("accent")
                };
              },
              children: LOCK2
            }), createComponent2(Text, {
              get ["class"]() {
                return C.lockClock;
              },
              get style() {
                return {
                  textColor: color("bright_foreground")
                };
              },
              get children() {
                return props.clock();
              }
            }), createComponent2(Text, {
              get ["class"]() {
                return C.lockDate;
              },
              get style() {
                return {
                  textColor: color("foreground")
                };
              },
              get children() {
                return props.date();
              }
            })];
          }
        });
      }
    });
  }

  // shell/src/stage/screensaver.tsx
  var [active2, setActive] = createSignal(false);
  var [text, setText] = createSignal("");
  var screensaverActive = active2;
  function startScreensaver() {
    if (active2())
      return;
    request({
      method: "screensaver"
    }).then((t) => {
      setText(t);
      setActive(true);
    }, () => {});
  }
  function stopScreensaver() {
    setActive(false);
  }
  serve("pocket.screensaver", {
    start: () => (startScreensaver(), "ok"),
    stop: () => (stopScreensaver(), "ok"),
    status: () => active2() ? "running" : "stopped"
  });
  var CELL_W2 = 6;
  var CELL_H4 = 14;
  var HOLD = 7;
  var OUT = 1.6;
  function cellsOf(source) {
    const lines = source.split(`
`);
    const cols = Math.max(1, ...lines.map((l) => [...l].length));
    const left = Math.round((512 - cols * CELL_W2) / 2);
    const top = Math.round((384 - lines.length * CELL_H4) / 2);
    const cells = [];
    lines.forEach((line, row) => [...line].forEach((ch, col) => {
      if (ch !== " ")
        cells.push({
          ch,
          col,
          row,
          x: left + col * CELL_W2,
          y: top + row * CELL_H4
        });
    }));
    return {
      cells,
      cols
    };
  }
  var hex2 = (name) => palette()[name] ?? "#7aa2f7";
  function mix2(a, b, t) {
    const ca = parseInt(a.slice(1, 7), 16);
    const cb = parseInt(b.slice(1, 7), 16);
    const ch = (shift) => Math.round((ca >> shift & 255) * (1 - t) + (cb >> shift & 255) * t);
    return "#" + (ch(16) << 16 | ch(8) << 8 | ch(0)).toString(16).padStart(6, "0");
  }
  var rand = (n) => Math.random() * n;
  var tween = (n, prop, to, dur, delay, easing = "out") => animate(n, prop, to, {
    dur,
    delay,
    easing
  });
  var EFFECTS = [
    {
      enter(nodes, cells, final) {
        cells.forEach((c, i) => {
          jump(nodes[i], "translateY", -(c.y + CELL_H4 + rand(60)));
          jump(nodes[i], "textColor", final(c));
          tween(nodes[i], "translateY", 0, 650, rand(1800), "in");
        });
        return 2.5;
      }
    },
    {
      enter(nodes, cells, final) {
        cells.forEach((c, i) => {
          jump(nodes[i], "translateX", c.row % 2 ? 560 : -560);
          jump(nodes[i], "textColor", final(c));
          tween(nodes[i], "translateX", 0, 900, c.row * 110 + c.col * 4, "out");
        });
        return 2.4;
      }
    },
    {
      enter(nodes, cells, final) {
        cells.forEach((c, i) => {
          jump(nodes[i], "translateX", 256 - c.x);
          jump(nodes[i], "translateY", 192 - c.y);
          jump(nodes[i], "opacity", 0);
          jump(nodes[i], "textColor", final(c));
          const delay = rand(500);
          tween(nodes[i], "translateX", 0, 1100, delay, "out-back");
          tween(nodes[i], "translateY", 0, 1100, delay, "out-back");
          tween(nodes[i], "opacity", 1, 300, delay);
        });
        return 1.8;
      }
    },
    {
      enter(nodes, cells, final) {
        const dark = hex2("muted");
        const bright = hex2("bright_foreground");
        cells.forEach((c, i) => {
          jump(nodes[i], "textColor", hex2("background"));
          tween(nodes[i], "textColor", dark, 200, rand(600));
        });
        after(0.7, () => cells.forEach((c, i) => {
          if (nodes[i])
            tween(nodes[i], "textColor", bright, 120, c.col * 16 + rand(160));
        }));
        after(1.9, () => cells.forEach((c, i) => {
          if (nodes[i])
            tween(nodes[i], "textColor", final(c), 500, c.col * 16);
        }));
        return 3.8;
      }
    },
    {
      enter(nodes, cells, final) {
        cells.forEach((c, i) => {
          jump(nodes[i], "opacity", 0);
          jump(nodes[i], "scale", 2.5);
          jump(nodes[i], "textColor", final(c));
          const delay = (c.col + c.row * 4) * 14;
          tween(nodes[i], "opacity", 1, 200, delay);
          tween(nodes[i], "scale", 1, 400, delay, "out");
        });
        return 2.3;
      }
    },
    {
      enter(nodes, cells, final) {
        cells.forEach((c, i) => {
          jump(nodes[i], "translateX", 256 - c.x + rand(80) - 40);
          jump(nodes[i], "translateY", 400 - c.y);
          jump(nodes[i], "opacity", 0);
          jump(nodes[i], "textColor", final(c));
          const delay = rand(1600);
          tween(nodes[i], "translateX", 0, 800, delay, "out");
          tween(nodes[i], "translateY", 0, 800, delay, "out");
          tween(nodes[i], "opacity", 1, 150, delay);
        });
        return 2.6;
      }
    }
  ];
  function leave(nodes, cells) {
    const fall = Math.random() < 0.5;
    cells.forEach((c, i) => {
      if (!nodes[i])
        return;
      if (fall)
        tween(nodes[i], "translateY", 420 - c.y, 700, rand(900), "in");
      else
        tween(nodes[i], "opacity", 0, 400, rand(1000));
    });
  }
  function reset3(nodes, cells) {
    cells.forEach((_, i) => {
      const n = nodes[i];
      if (!n)
        return;
      for (const [prop, value] of [["translateX", 0], ["translateY", 0], ["opacity", 1], ["scale", 1]])
        jump(n, prop, value);
    });
  }
  function Art() {
    const {
      cells,
      cols
    } = cellsOf(text());
    const nodes = [];
    const from = hex2("accent");
    const to = hex2("magenta");
    const final = (c) => mix2(from, to, c.col / Math.max(1, cols - 1));
    const font = cjk(text(), CJK_SLOT_12);
    let running = true;
    let last = -1;
    onCleanup(() => running = false);
    const cycle = () => {
      if (!running)
        return;
      reset3(nodes, cells);
      let pick = Math.floor(rand(EFFECTS.length));
      if (pick === last)
        pick = (pick + 1) % EFFECTS.length;
      last = pick;
      const enter = EFFECTS[pick].enter(nodes, cells, final);
      after(enter + HOLD, () => {
        if (!running)
          return;
        leave(nodes, cells);
        after(OUT + 0.4, cycle);
      });
    };
    onMount(() => after(0.05, cycle));
    return createComponent2(For, {
      each: cells,
      children: (c, i) => createComponent2(Text, {
        ref: (n) => nodes[i()] = n,
        class: "absolute font-mono text-xs leading-[14]",
        get style() {
          return {
            insetL: c.x,
            insetT: c.y,
            textColor: "#000000",
            ...font
          };
        },
        get children() {
          return c.ch;
        }
      })
    });
  }
  function Screensaver() {
    return createComponent2(Show, {
      get when() {
        return active2();
      },
      get children() {
        return createComponent2(View, {
          class: "absolute left-0 top-0 w-[512] h-[384] overflow-hidden",
          style: {
            bgColor: "#000000"
          },
          get children() {
            return createComponent2(Art, {});
          }
        });
      }
    });
  }
  function ScreensaverDeck() {
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] h-[384]",
      style: {
        bgColor: "#000000"
      }
    });
  }

  // shell/src/app.tsx
  var REPEATS = BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT;
  var REPEAT_AFTER2 = 18;
  var REPEAT_EVERY2 = 4;
  var KEYS = [BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT, BTN.CIRCLE, BTN.CROSS, BTN.TRIANGLE, BTN.SQUARE, BTN.START, BTN.SELECT, BTN.ZL, BTN.ZR];
  var WEEKDAYS2 = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS3 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var two3 = (n) => n < 10 ? `0${n}` : String(n);
  function Shell() {
    const [now, setNow] = createSignal(new Date);
    const tick = () => {
      setNow(new Date);
      after(1, tick);
    };
    after(1, tick);
    const time = () => `${two3(now().getHours())}:${two3(now().getMinutes())}`;
    const date = () => `${WEEKDAYS2[now().getDay()]}, ${now().getDate()} ${MONTHS3[now().getMonth()]}`;
    const focusedPackage = () => {
      const w = focused2();
      return w?.kind === "app" ? w : null;
    };
    createEffect(on([current4, focused2], () => closeMenu(), {
      defer: true
    }));
    createEffect(on(locked, (l) => l && closeCard(), {
      defer: true
    }));
    createEffect(on(() => `${field() ? 1 : 0}:${card() ?? ""}:${focused2()?.id ?? ""}`, resetKeyboard, {
      defer: true
    }));
    createEffect(() => {
      revision();
      for (let ws = 0;ws < WORKSPACES; ws++)
        for (const w of windowsOn(ws))
          if (w.kind === "app")
            showPackage(w.app, ws === current4() && !appletRefused(w.app));
    });
    let seen = new Set;
    createEffect(() => {
      const next = new Set(visibleWindows().map(appletOf).filter((a) => a !== undefined));
      for (const a of seen)
        if (!next.has(a))
          a.hidden?.();
      for (const a of next)
        if (!seen.has(a))
          a.shown?.();
      seen = next;
    });
    let lastInput = Date.now();
    let saverDue = true;
    let lockDue = true;
    const fresh = (act) => request({
      method: "state"
    }).then((s) => s.idle && !s.idle.stayAwake && act(s.idle), () => {});
    const idleTick = () => {
      after(1, idleTick);
      const settings = state()?.idle;
      if (!settings)
        return;
      if (mediaPlaying())
        lastInput = Date.now();
      const idle = (Date.now() - lastInput) / 1000;
      if (saverDue && settings.screensaver > 0 && idle >= settings.screensaver) {
        saverDue = false;
        fresh((s) => !s.screensaverOff && startScreensaver());
      }
      if (lockDue && settings.lock > 0 && idle >= settings.lock) {
        lockDue = false;
        fresh(() => lock());
      }
    };
    after(1, idleTick);
    const input = () => {
      lastInput = Date.now();
      saverDue = lockDue = true;
    };
    const press = (key, held) => {
      if (screensaverActive())
        return stopScreensaver();
      if (qrOpen())
        return closeQr();
      const layer = layerOf(held & MODIFIERS);
      if (layer !== "plain") {
        if (locked())
          return;
        const chord = chordFor(layer, key);
        if (chord)
          perform(chord.action);
        return;
      }
      const chord = chordFor("plain", key);
      if (chord)
        return locked() ? undefined : perform(chord.action);
      if (key & BTN.SELECT)
        return locked() ? undefined : cycleLayout();
      if (!locked() && card() && cardButton(key))
        return;
      if (!locked() && !field() && focusedPackage() && !focusedPackage().appletSurface)
        return;
      if (key & BTN.CIRCLE && composing())
        return sendKey(" ");
      const name = buttonKey(key);
      if (name)
        sendKey(name);
    };
    let fed = null;
    const feed = (buttons, contacts) => {
      const w = focusedPackage();
      if (fed !== null && fed !== w?.app) {
        feedPackage(fed, 0, []);
        fed = null;
      }
      if (!w)
        return;
      fed = w.app;
      if (w.appletSurface)
        return feedPackage(w.app, touchAppButtons(), pointerContacts(w.app));
      const mask = layerOf(buttons & MODIFIERS) === "plain" && !locked() && !card() && !field() ? buttons & ~(MODIFIERS | BTN.SELECT | BTN.ZL | BTN.ZR) : 0;
      feedPackage(w.app, mask, contacts);
    };
    const bodyTouch = (frame) => {
      switch (layout2()) {
        case "keys":
          keyboardTouch(frame, "body");
          return touchpadTouch(frame);
        case "pad":
          return touchpadTouch(frame);
        case "home":
          homeTouch(frame);
          return [];
      }
    };
    let keysNode;
    createEffect(on(layout2, (l) => {
      glide(keysNode, "opacity", l === "keys" ? 1 : 0, 140);
      glide(keysNode, "translateY", l === "keys" ? 0 : -14, 180);
    }, {
      defer: true
    }));
    let held = 0;
    let heldFor = 0;
    let shoulderFor = 0;
    let swallow = false;
    onFrame((pressed) => {
      const buttons = pressed | remoteButtons();
      const touch = trackTouches();
      const down = buttons & ~held;
      if (down || touch.raw)
        input();
      if (buttons & held & REPEATS)
        heldFor++;
      else
        heldFor = 0;
      held = buttons;
      setHeld(layerOf(buttons & MODIFIERS));
      shoulderFor = buttons & MODIFIERS ? shoulderFor + 1 : 0;
      tickLegend(!locked() && !!(buttons & MODIFIERS), shoulderFor);
      stickTick(!locked() && layerOf(buttons & MODIFIERS) === "move");
      for (const key of KEYS) {
        if (down & key)
          press(key, buttons);
        else if (key & REPEATS & buttons && heldFor > REPEAT_AFTER2 && (heldFor - REPEAT_AFTER2) % REPEAT_EVERY2 === 0)
          press(key, buttons);
      }
      if (screensaverActive() && touch.raw) {
        stopScreensaver();
        swallow = true;
      }
      if (swallow) {
        swallow = touch.raw > 0;
        return;
      }
      if (locked())
        return keyboardTouch(touch, "full");
      const first = touch.down[0];
      pressAt(!first ? null : first.start.y < STRIP_H ? stripTarget(first.x) : layout2() === "home" ? homeTarget(first.x, first.y - BODY_TOP) : roundTarget(first.x, first.y - BODY_TOP));
      stripTouch(band(touch, 0, STRIP_H));
      const contacts = bodyTouch(band(touch, BODY_TOP, 384));
      feed(buttons, contacts);
    });
    return createComponent2(View, {
      class: "absolute left-0 top-0 w-[512] h-[384]",
      get children() {
        return [createComponent2(Wallpaper, {}), createComponent2(Windows, {}), createComponent2(Bar, {
          now,
          focused: panel
        }), createComponent2(Card, {}), createComponent2(KeySheet, {}), createComponent2(QrSheet, {}), createComponent2(Osd, {}), createComponent2(Toasts, {}), createComponent2(Pointer, {
          shown: () => !locked() && (layout2() === "pad" ? !surfacePackage() : layout2() === "keys" && pointerAwake())
        }), createComponent2(LockStage, {
          clock: time,
          date
        }), createComponent2(Screensaver, {}), createComponent2(AuxiliarySurface, {
          get children() {
            return createComponent2(View, {
              class: "absolute left-0 top-0 w-[512] h-[384]",
              get style() {
                return {
                  bgColor: color("darker_background")
                };
              },
              get children() {
                return createComponent2(Show, {
                  get when() {
                    return !screensaverActive();
                  },
                  get fallback() {
                    return createComponent2(ScreensaverDeck, {});
                  },
                  get children() {
                    return [createComponent2(View, {
                      class: "absolute left-0 top-0 w-[512] h-[384] contain-strict",
                      get style() {
                        return {
                          opacity: locked() ? 0 : 1
                        };
                      },
                      get children() {
                        return [createComponent2(View, {
                          class: "absolute left-0 w-[512] overflow-hidden contain-strict",
                          style: {
                            insetT: BODY_TOP,
                            height: BODY_H
                          },
                          get children() {
                            return [createComponent2(View, {
                              class: "absolute left-0 top-0 w-[512] contain-strict",
                              get style() {
                                return {
                                  height: BODY_H,
                                  opacity: layout2() === "home" ? 1 : 0
                                };
                              },
                              get children() {
                                return createComponent2(Home, {});
                              }
                            }), createComponent2(View, {
                              class: "absolute left-0 top-0 w-[512] contain-strict",
                              get style() {
                                return {
                                  height: BODY_H,
                                  opacity: layout2() === "home" ? 0 : 1
                                };
                              },
                              get children() {
                                return createComponent2(Touchpad, {});
                              }
                            }), createComponent2(View, {
                              class: "absolute left-0 top-0 w-[512] contain-strict",
                              get style() {
                                return {
                                  height: BODY_H,
                                  opacity: untrack(layout2) === "keys" ? 1 : 0,
                                  translateY: untrack(layout2) === "keys" ? 0 : -14
                                };
                              },
                              ref: (n) => keysNode = n,
                              get children() {
                                return createComponent2(Keyboard, {
                                  mode: "body"
                                });
                              }
                            })];
                          }
                        }), createComponent2(Strip, {})];
                      }
                    }), createComponent2(View, {
                      class: "absolute left-0 top-0 w-[512] h-[384] contain-strict",
                      get style() {
                        return {
                          opacity: locked() ? 1 : 0
                        };
                      },
                      get children() {
                        return createComponent2(Keyboard, {
                          mode: "full"
                        });
                      }
                    }), createComponent2(DeckLegend, {})];
                  }
                });
              }
            });
          }
        })];
      }
    });
  }

  // vendor/pocketjs/framework/src/devtools.ts
  var TAPE_CAP = 36000;
  var TOUCH_CHUNK_BITS = 7;
  var TOUCH_CHUNK_SIZE = 1 << TOUCH_CHUNK_BITS;
  function createTouchRing(surfaces = false) {
    return {
      pages: [],
      pageCount: 0,
      surfaces
    };
  }
  function writeTouch(ring, at, value, limit) {
    const page = at >>> TOUCH_CHUNK_BITS;
    const slot = at & TOUCH_CHUNK_SIZE - 1;
    let chunk = ring.pages[page];
    if (!value) {
      if (chunk?.sizes[slot]) {
        chunk.sizes[slot] = 0;
        if (--chunk.occupied === 0) {
          ring.pages[page] = undefined;
          if (--ring.pageCount === 0)
            ring.pages = [];
        }
      }
      return;
    }
    const length = Math.min(value.length, limit);
    if (!chunk) {
      let stride = 1;
      while (stride < length)
        stride *= 2;
      chunk = ring.pages[page] = {
        sizes: new Uint8Array(TOUCH_CHUNK_SIZE),
        words: ring.surfaces ? new Uint8Array(TOUCH_CHUNK_SIZE * stride) : new Float64Array(TOUCH_CHUNK_SIZE * stride),
        stride,
        occupied: 0
      };
      ring.pageCount++;
    } else if (length > chunk.stride) {
      let stride = chunk.stride;
      while (stride < length)
        stride *= 2;
      const words = ring.surfaces ? new Uint8Array(TOUCH_CHUNK_SIZE * stride) : new Float64Array(TOUCH_CHUNK_SIZE * stride);
      for (let frame = 0;frame < TOUCH_CHUNK_SIZE; frame++) {
        for (let word = 0;word < chunk.sizes[frame] - 1; word++) {
          words[frame * stride + word] = chunk.words[frame * chunk.stride + word];
        }
      }
      chunk.words = words;
      chunk.stride = stride;
    }
    if (!chunk.sizes[slot])
      chunk.occupied++;
    chunk.sizes[slot] = length + 1;
    for (let word = 0;word < length; word++) {
      chunk.words[slot * chunk.stride + word] = ring.surfaces ? value[word] === 1 ? 1 : 0 : value[word];
    }
  }
  function readTouch(ring, at) {
    const chunk = ring.pages[at >>> TOUCH_CHUNK_BITS];
    const slot = at & TOUCH_CHUNK_SIZE - 1;
    const size = chunk?.sizes[slot];
    if (!size)
      return null;
    const value = new Array(size - 1);
    for (let word = 0;word < value.length; word++)
      value[word] = chunk.words[slot * chunk.stride + word];
    return value;
  }
  var TREE_THROTTLE = 30;
  var STATS_EVERY = 30;
  var state3 = {
    ops: null,
    transport: null,
    app: undefined,
    frame: 0,
    tape: new Uint16Array(TAPE_CAP),
    tapeAnalog: new Uint16Array(TAPE_CAP),
    tapeRightAnalog: null,
    tapeTouch: null,
    tapeTouchSurfaces: null,
    tapeAxes: null,
    tapeMotion: null,
    tapeStart: 0,
    tapeLen: 0,
    tapeFirstFrame: 0,
    replayMasks: null,
    replayAnalog: null,
    replayRightAnalog: null,
    replayTouch: null,
    replayTouchSurfaces: null,
    replayAxes: null,
    replayMotion: null,
    replayAt: 0,
    paused: false,
    stepQueued: 0,
    inspectReportId: null,
    inspectAskedAt: 0,
    treeDirty: true,
    treeSentAt: -TREE_THROTTLE,
    saidHello: false,
    panelAttached: false,
    hostCalls: 0
  };
  function initDevtools(ops) {
    const g = globalThis;
    if (!g.console)
      g.console = {
        log() {},
        warn() {},
        error() {}
      };
    state3.ops = ops;
    state3.frame = 0;
    state3.tapeStart = 0;
    state3.tapeLen = 0;
    state3.tapeFirstFrame = 0;
    state3.tapeTouch = null;
    state3.tapeRightAnalog = null;
    state3.tapeTouchSurfaces = null;
    state3.tapeAxes = null;
    state3.tapeMotion = null;
    state3.replayMasks = null;
    state3.replayAnalog = null;
    state3.replayRightAnalog = null;
    state3.replayTouch = null;
    state3.replayTouchSurfaces = null;
    state3.replayAxes = null;
    state3.replayMotion = null;
    state3.paused = false;
    state3.stepQueued = 0;
    state3.inspectReportId = null;
    state3.inspectAskedAt = 0;
    state3.treeDirty = true;
    state3.treeSentAt = -TREE_THROTTLE;
    state3.saidHello = false;
    state3.panelAttached = false;
    state3.hostCalls = 0;
    state3.app = globalThis.__pocketApp;
    const injected = globalThis.__pocketDevtoolsTransport;
    if (injected) {
      state3.transport = injected;
    } else if (ops.__dbgActive?.() && ops.__dbgPoll && ops.__dbgSend) {
      state3.transport = {
        send: (l) => ops.__dbgSend(l),
        recv: () => ops.__dbgPoll(),
        everyFrames: 10,
        listening: ops.__dbgConnected ? () => ops.__dbgConnected() : undefined
      };
    } else {
      state3.transport = null;
    }
    if (state3.transport) {
      setTreeMutationHook(() => {
        state3.treeDirty = true;
      });
    } else {
      setTreeMutationHook(null);
    }
    bridgeConsole();
    globalThis.__pocketDevtools = api;
  }
  function wrapFrameHandler(h) {
    return (buttons, analogArg, touchArg, hitsArg, touchSurfacesArg, rightAnalogArg, axisDeltasArg, motionArg, textArg) => {
      state3.hostCalls++;
      if (state3.transport) {
        pollTransport();
        flushInspectReport();
      }
      let mask = buttons;
      let analog = analogArg === undefined ? ANALOG_CENTER : analogArg & 65535;
      let rightAnalog = rightAnalogArg === undefined ? ANALOG_CENTER : rightAnalogArg & 65535;
      let touch = touchArg;
      let hits = hitsArg;
      let touchSurfaces = touchSurfacesArg;
      let axisDeltas = axisDeltasArg;
      let motion = motionArg;
      if (state3.replayMasks) {
        if (state3.replayAt < state3.replayMasks.length) {
          if (state3.paused && state3.stepQueued <= 0)
            return;
          axisDeltas = state3.replayAxes?.[state3.replayAt] ?? EMPTY_AXIS_DELTAS;
          motion = state3.replayMotion?.[state3.replayAt] ?? null;
          mask = state3.replayMasks[state3.replayAt];
          analog = state3.replayAnalog ? state3.replayAnalog[state3.replayAt] : ANALOG_CENTER;
          rightAnalog = state3.replayRightAnalog ? state3.replayRightAnalog[state3.replayAt] : ANALOG_CENTER;
          touch = state3.replayTouch ? state3.replayTouch[state3.replayAt] : undefined;
          touchSurfaces = state3.replayTouchSurfaces ? state3.replayTouchSurfaces[state3.replayAt] : undefined;
          hits = undefined;
          state3.replayAt++;
        } else {
          state3.replayMasks = null;
          state3.replayAnalog = null;
          state3.replayRightAnalog = null;
          state3.replayTouch = null;
          state3.replayTouchSurfaces = null;
          state3.replayAxes = null;
          state3.replayMotion = null;
          send({
            t: "replayDone",
            frame: state3.frame
          });
        }
      }
      if (state3.paused) {
        if (state3.stepQueued <= 0)
          return;
        state3.stepQueued--;
        state3.ops?.debugStep?.();
      }
      axisDeltas = __takeAxisDeltas(axisDeltas);
      motion = __takeMotionState(motion);
      recordMask(mask, analog, touch, touchSurfaces, rightAnalog, axisDeltas, motion);
      state3.frame++;
      try {
        h(mask, analog, touch, hits, touchSurfaces, rightAnalog, axisDeltas, motion, textArg);
      } catch (e) {
        send({
          t: "error",
          frame: state3.frame,
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined
        });
        throw e;
      }
      if (state3.transport)
        afterFrame();
    };
  }
  function recordMask(mask, analog, touch, touchSurfaces, rightAnalog, axisDeltas, motion) {
    const axes = axisDeltas?.length ? axisDeltas.map((value) => ({
      ...value
    })) : null;
    if (axes && !state3.tapeAxes)
      state3.tapeAxes = new Array(TAPE_CAP).fill(null);
    if (motion && !state3.tapeMotion)
      state3.tapeMotion = new Array(TAPE_CAP).fill(null);
    const right = rightAnalog ?? ANALOG_CENTER;
    if (right !== ANALOG_CENTER && !state3.tapeRightAnalog)
      state3.tapeRightAnalog = new Uint16Array(TAPE_CAP).fill(ANALOG_CENTER);
    const contacts = touch && touch.length > 0 ? touch : null;
    const contactCount = Math.min(contacts?.length ?? 0, 16);
    if (contacts && !state3.tapeTouch) {
      state3.tapeTouch = createTouchRing();
    }
    const surfaces = contacts && touchSurfaces ? touchSurfaces : null;
    if (surfaces && !state3.tapeTouchSurfaces) {
      for (let word = 0;word < Math.min(surfaces.length, contactCount); word++) {
        if (surfaces[word] === 1) {
          state3.tapeTouchSurfaces = createTouchRing(true);
          break;
        }
      }
    }
    if (state3.tapeLen < TAPE_CAP) {
      const at = (state3.tapeStart + state3.tapeLen) % TAPE_CAP;
      state3.tape[at] = mask;
      state3.tapeAnalog[at] = analog;
      if (state3.tapeRightAnalog)
        state3.tapeRightAnalog[at] = right;
      if (state3.tapeTouch)
        writeTouch(state3.tapeTouch, at, contacts, contactCount);
      if (state3.tapeTouchSurfaces)
        writeTouch(state3.tapeTouchSurfaces, at, surfaces, contactCount);
      if (state3.tapeAxes)
        state3.tapeAxes[at] = axes;
      if (state3.tapeMotion)
        state3.tapeMotion[at] = motion ?? null;
      state3.tapeLen++;
    } else {
      state3.tape[state3.tapeStart] = mask;
      state3.tapeAnalog[state3.tapeStart] = analog;
      if (state3.tapeRightAnalog)
        state3.tapeRightAnalog[state3.tapeStart] = right;
      if (state3.tapeTouch)
        writeTouch(state3.tapeTouch, state3.tapeStart, contacts, contactCount);
      if (state3.tapeTouchSurfaces)
        writeTouch(state3.tapeTouchSurfaces, state3.tapeStart, surfaces, contactCount);
      if (state3.tapeAxes)
        state3.tapeAxes[state3.tapeStart] = axes;
      if (state3.tapeMotion)
        state3.tapeMotion[state3.tapeStart] = motion ?? null;
      state3.tapeStart = (state3.tapeStart + 1) % TAPE_CAP;
      state3.tapeFirstFrame++;
    }
  }
  function rlePairs(ring) {
    const out = [];
    for (let i = 0;i < state3.tapeLen; i++) {
      const v = ring[(state3.tapeStart + i) % TAPE_CAP];
      const last = out[out.length - 1];
      if (last && last[0] === v)
        last[1]++;
      else
        out.push([v, 1]);
    }
    return out;
  }
  function exportTape() {
    const tape = {
      v: 1,
      app: state3.app,
      frames: state3.tapeLen,
      masks: rlePairs(state3.tape),
      startFrame: state3.tapeFirstFrame
    };
    const analog = rlePairs(state3.tapeAnalog);
    if (analog.length > 1 || analog.length === 1 && analog[0][0] !== ANALOG_CENTER) {
      tape.analog = analog;
    }
    if (state3.tapeRightAnalog) {
      const right = rlePairs(state3.tapeRightAnalog);
      if (right.some(([value]) => value !== ANALOG_CENTER))
        tape.rightAnalog = right;
    }
    if (state3.tapeTouch) {
      const touch = [];
      for (let i = 0;i < state3.tapeLen; i++) {
        const contacts = readTouch(state3.tapeTouch, (state3.tapeStart + i) % TAPE_CAP);
        if (contacts)
          touch.push([i, contacts]);
      }
      if (touch.length > 0) {
        tape.v = 2;
        tape.touch = touch;
      }
    }
    if (state3.tapeTouchSurfaces) {
      const touchSurfaces = [];
      for (let i = 0;i < state3.tapeLen; i++) {
        const surfaces = readTouch(state3.tapeTouchSurfaces, (state3.tapeStart + i) % TAPE_CAP);
        if (surfaces)
          touchSurfaces.push([i, surfaces]);
      }
      if (touchSurfaces.length > 0) {
        tape.v = 3;
        tape.touchSurfaces = touchSurfaces;
      }
    }
    if (state3.tapeAxes) {
      const axes = [];
      for (let i = 0;i < state3.tapeLen; i++) {
        const deltas = state3.tapeAxes[(state3.tapeStart + i) % TAPE_CAP];
        if (deltas)
          axes.push([i, deltas.map((value) => ({
            ...value
          }))]);
      }
      if (axes.length) {
        tape.v = 4;
        tape.axes = axes;
      }
    }
    if (state3.tapeMotion) {
      const motion = [];
      for (let i = 0;i < state3.tapeLen; i++) {
        const estimate = state3.tapeMotion[(state3.tapeStart + i) % TAPE_CAP];
        if (estimate)
          motion.push([i, __copyMotionState(estimate)]);
      }
      if (motion.length) {
        tape.v = 5;
        tape.motion = motion;
      }
    }
    return tape;
  }
  function expandPairs(pairs, fill, total) {
    const out = new Uint16Array(total).fill(fill);
    let at = 0;
    for (const [v, n] of pairs) {
      out.fill(v, at, Math.min(at + n, total));
      at += n;
    }
    return out;
  }
  function expandTape(tape) {
    let total = 0;
    for (const [, n] of tape.masks)
      total += n;
    return expandPairs(tape.masks, 0, total);
  }
  function expandTapeAnalog(tape) {
    let total = 0;
    for (const [, n] of tape.masks)
      total += n;
    return expandPairs(tape.analog ?? [], ANALOG_CENTER, total);
  }
  function expandTapeRightAnalog(tape) {
    return expandPairs(tape.rightAnalog ?? [], ANALOG_CENTER, tape.masks.reduce((n, [, count]) => n + count, 0));
  }
  function expandTapeTouch(tape) {
    let total = 0;
    for (const [, n] of tape.masks)
      total += n;
    const out = new Array(total).fill(undefined);
    for (const [frame, contacts] of tape.touch ?? []) {
      if (frame >= 0 && frame < total)
        out[frame] = contacts;
    }
    return out;
  }
  function expandTapeAxes(tape) {
    const total = tape.masks.reduce((n, [, count]) => n + count, 0);
    const out = new Array(total).fill(undefined);
    for (const [frame, deltas] of tape.axes ?? []) {
      if (Number.isInteger(frame) && frame >= 0 && frame < total)
        out[frame] = deltas.map((value) => ({
          ...value
        }));
    }
    return out;
  }
  function expandTapeMotion(tape) {
    const total = tape.masks.reduce((n, [, count]) => n + count, 0);
    const out = new Array(total).fill(undefined);
    for (const [frame, estimate] of tape.motion ?? []) {
      if (Number.isInteger(frame) && frame >= 0 && frame < total)
        out[frame] = __copyMotionState(estimate);
    }
    return out;
  }
  function expandTapeTouchSurfaces(tape) {
    let total = 0;
    for (const [, n] of tape.masks)
      total += n;
    const out = new Array(total).fill(undefined);
    for (const [frame, surfaces] of tape.touchSurfaces ?? []) {
      if (frame >= 0 && frame < total)
        out[frame] = surfaces;
    }
    return out;
  }
  function send(msg) {
    try {
      state3.transport?.send(JSON.stringify(msg));
    } catch {}
  }
  function pollTransport() {
    const t = state3.transport;
    const every = t.everyFrames ?? 1;
    if (every > 1 && state3.hostCalls % every !== 0)
      return;
    if (!state3.saidHello) {
      state3.saidHello = true;
      send({
        t: "hello",
        app: state3.app,
        host: hostKind(),
        frame: state3.frame
      });
    }
    for (let guard = 0;guard < 64; guard++) {
      const chunk = t.recv();
      if (!chunk)
        break;
      for (const line of chunk.split(`
`)) {
        if (line.trim())
          handleMessage(line);
      }
    }
  }
  function handleMessage(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const ops = state3.ops;
    switch (msg.t) {
      case "inspect": {
        const id = typeof msg.id === "number" ? msg.id : 0;
        ops?.debugInspect?.(id);
        state3.inspectReportId = id || null;
        state3.inspectAskedAt = state3.hostCalls;
        if (!id)
          send({
            t: "inspect",
            id: 0,
            rect: null
          });
        break;
      }
      case "pause":
        state3.paused = true;
        state3.stepQueued = 0;
        ops?.debugPause?.(true);
        sendStats();
        break;
      case "resume":
        state3.paused = false;
        ops?.debugPause?.(false);
        sendStats();
        break;
      case "step":
        state3.stepQueued += typeof msg.n === "number" && msg.n > 0 ? msg.n : 1;
        break;
      case "getTree":
        sendTree();
        break;
      case "eval": {
        let ok = true;
        let value;
        try {
          value = fmt((0, eval)(String(msg.code)));
        } catch (e) {
          ok = false;
          value = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        }
        send({
          t: "evalResult",
          id: msg.id,
          ok,
          value
        });
        break;
      }
      case "dumpTape":
        send({
          t: "tape",
          tape: exportTape()
        });
        break;
      case "devStats": {
        let data = null;
        const raw = ops?.debugStats?.();
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
        }
        send({
          t: "devStats",
          frame: state3.frame,
          data
        });
        break;
      }
      case "screenshot": {
        if (ops?.__dbgShot?.()) {
          send({
            t: "screenshotRaw",
            file: "shot.raw",
            w: 480,
            h: 272,
            stride: 512,
            frame: state3.frame
          });
        } else {
          send({
            t: "log",
            level: "warn",
            args: ["screenshot: not supported on this host"]
          });
        }
        break;
      }
      case "replay": {
        const tape = msg.tape;
        if (tape && Array.isArray(tape.masks)) {
          state3.replayMotion = tape.motion ? expandTapeMotion(tape) : null;
          state3.replayAxes = tape.axes ? expandTapeAxes(tape) : null;
          state3.replayMasks = expandTape(tape);
          state3.replayAnalog = tape.analog ? expandTapeAnalog(tape) : null;
          state3.replayRightAnalog = tape.rightAnalog ? expandTapeRightAnalog(tape) : null;
          state3.replayTouch = tape.touch ? expandTapeTouch(tape) : null;
          state3.replayTouchSurfaces = tape.touchSurfaces ? expandTapeTouchSurfaces(tape) : null;
          state3.replayAt = 0;
        }
        break;
      }
      default:
        break;
    }
  }
  function panelListening() {
    const listening = state3.transport?.listening;
    return !listening || listening();
  }
  function afterFrame() {
    if (!panelListening()) {
      state3.panelAttached = false;
      return;
    }
    if (!state3.panelAttached) {
      state3.panelAttached = true;
      state3.treeDirty = true;
      state3.treeSentAt = -TREE_THROTTLE;
    }
    if (state3.treeDirty && state3.frame - state3.treeSentAt >= TREE_THROTTLE) {
      sendTree();
    }
    if (state3.frame % STATS_EVERY === 0)
      sendStats();
  }
  function flushInspectReport() {
    const id = state3.inspectReportId;
    if (id == null)
      return;
    const ops = state3.ops;
    if (!ops?.debugRectXY || !ops.debugRectWH) {
      state3.inspectReportId = null;
      return;
    }
    const xy = ops.debugRectXY();
    if (xy === -1) {
      if (state3.hostCalls - state3.inspectAskedAt > 60) {
        state3.inspectReportId = null;
        send({
          t: "inspect",
          id,
          rect: null
        });
      }
      return;
    }
    const wh = ops.debugRectWH();
    state3.inspectReportId = null;
    send({
      t: "inspect",
      id,
      rect: [xy << 16 >> 16, xy >> 16, wh & 65535, wh >> 16 & 65535]
    });
  }
  function sendStats() {
    send({
      t: "stats",
      frame: state3.frame,
      nodes: countMountedNodes(),
      tapeLen: state3.tapeLen,
      paused: state3.paused
    });
  }
  function sendTree() {
    state3.treeDirty = false;
    state3.treeSentAt = state3.frame;
    send({
      t: "tree",
      frame: state3.frame,
      root: serializeMountedTree()
    });
  }
  function isTreeMirror(value) {
    if (value == null || typeof value !== "object")
      return false;
    const candidate = value;
    return typeof candidate.id === "number" && typeof candidate.type === "number";
  }
  function forEachTreeMirror(value, visit) {
    if (Array.isArray(value)) {
      for (const entry of value)
        forEachTreeMirror(entry, visit);
      return;
    }
    if (isTreeMirror(value)) {
      visit(value);
      return;
    }
    if (value != null && typeof value === "object") {
      const nodes = value.nodes;
      if (nodes !== undefined)
        forEachTreeMirror(nodes, visit);
    }
  }
  function forEachTreeChild(node, visit) {
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children)
      forEachTreeMirror(child, visit);
  }
  function serializeNode(node) {
    const out = {
      i: node.id,
      t: node.domTag ?? String(node.type)
    };
    if (node.debugName)
      out.n = node.debugName;
    const cls = node.domAttrs?.class;
    if (typeof cls === "string" && cls)
      out.c = cls;
    if (node.text)
      out.x = node.text.length > 80 ? node.text.slice(0, 79) + "…" : node.text;
    const kids = [];
    forEachTreeChild(node, (child) => {
      if (child.domNodeType === 8)
        return;
      kids.push(serializeNode(child));
    });
    if (kids.length)
      out.k = kids;
    return out;
  }
  function namedSurfaceRoot(node, name) {
    const out = serializeNode(node);
    if (!out.n)
      out.n = name;
    return out;
  }
  function serializeMountedTree() {
    if (!hasAuxiliarySurface())
      return serializeNode(rootMirror);
    return {
      i: 0,
      t: "surfaces",
      v: 1,
      n: "Displays",
      k: [namedSurfaceRoot(rootMirror, "Primary display"), namedSurfaceRoot(getAuxiliarySurfaceRoots().native, "Auxiliary display")]
    };
  }
  function countNodes(node) {
    let n = 1;
    forEachTreeChild(node, (child) => {
      n += countNodes(child);
    });
    return n;
  }
  function countMountedNodes() {
    let count = countNodes(rootMirror);
    if (hasAuxiliarySurface())
      count += countNodes(getAuxiliarySurfaceRoots().native);
    return count;
  }
  function bridgeConsole() {
    const g = globalThis;
    if (!g.console)
      g.console = {};
    const c = g.console;
    const bridge = state3.transport ? {
      send,
      listening: panelListening
    } : {
      send() {},
      listening: () => false
    };
    if (c.__pocketBridge) {
      c.__pocketBridge.current = bridge;
      return;
    }
    if (!state3.transport)
      return;
    const holder = {
      current: bridge
    };
    c.__pocketBridge = holder;
    for (const level of ["log", "warn", "error"]) {
      const original = c[level];
      c[level] = (...args) => {
        if (holder.current.listening())
          holder.current.send({
            t: "log",
            level,
            args: args.map((a) => fmt(a))
          });
        original?.apply(c, args);
      };
    }
  }
  function fmt(v, depth = 0) {
    if (v === undefined)
      return "undefined";
    if (v === null)
      return "null";
    const t = typeof v;
    if (t === "string") {
      const s = v;
      return depth === 0 ? clip(s) : JSON.stringify(clip(s));
    }
    if (t === "number" || t === "boolean" || t === "bigint")
      return String(v);
    if (t === "function") {
      const name = v.name;
      return name ? `[function ${name}]` : "[function]";
    }
    if (depth >= 3)
      return Array.isArray(v) ? "[…]" : "{…}";
    if (Array.isArray(v)) {
      const items = v.slice(0, 20).map((x) => fmt(x, depth + 1));
      if (v.length > 20)
        items.push(`… ${v.length - 20} more`);
      return `[${items.join(", ")}]`;
    }
    if (v instanceof Error)
      return `${v.name}: ${v.message}`;
    const entries = Object.entries(v).slice(0, 20);
    const body = entries.map(([k, x]) => `${k}: ${fmt(x, depth + 1)}`).join(", ");
    return `{${body}}`;
  }
  function clip(s) {
    return s.length > 200 ? s.slice(0, 199) + "…" : s;
  }
  function hostKind() {
    const ops = state3.ops;
    if (typeof ops?.__host === "string")
      return ops.__host;
    if (ops?.__textures !== undefined)
      return "psp";
    if (typeof globalThis.document !== "undefined")
      return "web";
    return "headless";
  }
  var api = {
    get frame() {
      return state3.frame;
    },
    dumpTape: () => exportTape(),
    replay: (tape) => {
      state3.replayMotion = tape.motion ? expandTapeMotion(tape) : null;
      state3.replayAxes = tape.axes ? expandTapeAxes(tape) : null;
      state3.replayMasks = expandTape(tape);
      state3.replayAnalog = tape.analog ? expandTapeAnalog(tape) : null;
      state3.replayRightAnalog = tape.rightAnalog ? expandTapeRightAnalog(tape) : null;
      state3.replayTouch = tape.touch ? expandTapeTouch(tape) : null;
      state3.replayTouchSurfaces = tape.touchSurfaces ? expandTapeTouchSurfaces(tape) : null;
      state3.replayAt = 0;
    }
  };

  // vendor/pocketjs/framework/src/styles.ts
  var verbatim = new Map;
  var sortedAlias = new Map;
  function normalize(cls) {
    return cls.trim().replace(/\s+/g, " ");
  }
  function sortTokens(normalized) {
    return normalized.split(" ").sort().join(" ");
  }
  var ALIAS_AMBIGUOUS = -1;
  function registerStyles(table) {
    for (const key of Object.keys(table)) {
      const id = table[key];
      const norm = normalize(key);
      verbatim.set(norm, id);
      const sorted = sortTokens(norm);
      const prev = sortedAlias.get(sorted);
      sortedAlias.set(sorted, prev !== undefined && prev !== id ? ALIAS_AMBIGUOUS : id);
    }
  }
  function resolveStyle(cls) {
    const norm = normalize(cls);
    const hit = verbatim.get(norm);
    if (hit !== undefined)
      return hit;
    const alias = sortedAlias.get(sortTokens(norm));
    return alias === ALIAS_AMBIGUOUS ? undefined : alias;
  }

  // vendor/pocketjs/framework/src/gesture-core.ts
  var MAX_TRACKS = 8;
  var HIST = 8;
  var VELOCITY_WINDOW = 3;
  var DEFAULT_TAP_SLOP = 8;
  var DEFAULT_PAN_SLOP = 6;
  var DEFAULT_PINCH_SLOP = 10;
  var DEFAULT_LONG_PRESS_S = 0.5;
  var OBSERVING = 1;
  var TAP_DEAD = 2;
  var LONGPRESS_FIRED = 4;
  var PANNING = 8;
  var recognizers = [];
  var blockDepth = 0;
  var liveCount = 0;
  var tracks = Array.from({
    length: MAX_TRACKS
  }, (_, slot) => ({
    slot,
    used: false,
    present: false,
    surface: "primary",
    id: 0,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
    fdx: 0,
    fdy: 0,
    vx: 0,
    vy: 0,
    downFrame: 0,
    frames: 0,
    histX: new Int16Array(HIST),
    histY: new Int16Array(HIST),
    histHead: 0,
    histLen: 0,
    owners: [],
    claimedBy: null
  }));
  var pinchScratch = {
    ax: 0,
    ay: 0,
    bx: 0,
    by: 0,
    cx: 0,
    cy: 0,
    span: 0,
    startSpan: 0,
    dspan: 0,
    fdspan: 0
  };
  function withinSubtree(node, ancestor) {
    let n = node;
    while (n) {
      if (n === ancestor)
        return true;
      n = n.parent;
    }
    return false;
  }
  function regionMatches(rec, x, y, hitBox) {
    if ((rec.opts.surface ?? "primary") !== hitBox.surface)
      return false;
    const region = rec.opts.region;
    if (!region)
      return true;
    const target = region.node?.();
    if (target) {
      if (hitBox.hit === undefined) {
        hitBox.hit = resolveTouchHit(x, y, hitBox.fact, hitBox.surface);
      }
      const hit = hitBox.hit;
      if (hit)
        return withinSubtree(hit, target);
    }
    const r = region.rect?.();
    if (!r)
      return false;
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }
  function hasPinchHandlers(rec) {
    return !!(rec.opts.onPinchStart || rec.opts.onPinchMove || rec.opts.onPinchEnd);
  }
  function pinchSpan(axis, a, b) {
    if (axis === "y") {
      const d = a.y - b.y;
      return d < 0 ? -d : d;
    }
    if (axis === "x") {
      const d = a.x - b.x;
      return d < 0 ? -d : d;
    }
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function fillPinchScratch(rec, a, b) {
    const axis = rec.opts.axis ?? "any";
    const span = pinchSpan(axis, a, b);
    pinchScratch.ax = a.x;
    pinchScratch.ay = a.y;
    pinchScratch.bx = b.x;
    pinchScratch.by = b.y;
    pinchScratch.cx = (a.x + b.x) / 2;
    pinchScratch.cy = (a.y + b.y) / 2;
    pinchScratch.span = span;
    pinchScratch.startSpan = rec.baseSpan;
    pinchScratch.dspan = span - rec.baseSpan;
    pinchScratch.fdspan = span - rec.prevSpan;
  }
  function clearPinchPair(rec) {
    rec.pairA = -1;
    rec.pairB = -1;
  }
  function endPinch(rec) {
    if (rec.pinchA < 0)
      return;
    const a = tracks[rec.pinchA];
    const b = tracks[rec.pinchB];
    rec.pinchA = -1;
    rec.pinchB = -1;
    clearPinchPair(rec);
    fillPinchScratch(rec, a, b);
    rec.opts.onPinchEnd?.(pinchScratch);
  }
  function fireCancel(rec, t) {
    rec.flags[t.slot] = 0;
    if (t.claimedBy === rec)
      t.claimedBy = null;
    if (rec.pinchA === t.slot || rec.pinchB === t.slot)
      endPinch(rec);
    rec.opts.onCancel?.(t);
  }
  function claim(t, winner) {
    t.claimedBy = winner;
    for (const o of t.owners) {
      if (o !== winner && o.flags[t.slot] & OBSERVING)
        fireCancel(o, t);
    }
  }
  function releaseTrack(t) {
    for (const o of t.owners)
      o.flags[t.slot] = 0;
    t.owners.length = 0;
    t.claimedBy = null;
    t.used = false;
    liveCount--;
  }
  function beginTrack(t, surface, id, x, y, fact) {
    t.used = true;
    t.present = true;
    t.hit = fact;
    t.surface = surface;
    t.id = id;
    t.x = x;
    t.y = y;
    t.startX = x;
    t.startY = y;
    t.dx = 0;
    t.dy = 0;
    t.fdx = 0;
    t.fdy = 0;
    t.vx = 0;
    t.vy = 0;
    t.downFrame = virtualFrame();
    t.frames = 0;
    t.histX[0] = x;
    t.histY[0] = y;
    t.histHead = 1;
    t.histLen = 1;
    t.owners.length = 0;
    t.claimedBy = null;
    liveCount++;
    const hitBox = {
      hit: undefined,
      fact,
      surface
    };
    for (let i = recognizers.length - 1;i >= 0; i--) {
      const rec = recognizers[i];
      if (rec.disposed)
        continue;
      if (blockDepth > 0 && !rec.opts.allowWhenBlocked)
        continue;
      if (!regionMatches(rec, x, y, hitBox))
        continue;
      rec.flags[t.slot] = OBSERVING;
      t.owners.push(rec);
    }
    for (const o of t.owners)
      o.opts.onDown?.(t);
  }
  function updateTrack(t, x, y) {
    t.present = true;
    t.fdx = x - t.x;
    t.fdy = y - t.y;
    t.x = x;
    t.y = y;
    t.dx = x - t.startX;
    t.dy = y - t.startY;
    t.frames++;
    t.histX[t.histHead] = x;
    t.histY[t.histHead] = y;
    t.histHead = (t.histHead + 1) % HIST;
    if (t.histLen < HIST)
      t.histLen++;
    const k = Math.min(VELOCITY_WINDOW, t.histLen - 1);
    if (k <= 0) {
      t.vx = 0;
      t.vy = 0;
      return;
    }
    const hz = simulationHz();
    const last = (t.histHead - 1 + HIST) % HIST;
    const prev = (last - k + HIST) % HIST;
    t.vx = (t.histX[last] - t.histX[prev]) * hz / k;
    t.vy = (t.histY[last] - t.histY[prev]) * hz / k;
  }
  function recognizePinches() {
    for (let i = recognizers.length - 1;i >= 0; i--) {
      const rec = recognizers[i];
      if (rec.disposed || !hasPinchHandlers(rec))
        continue;
      if (rec.pinchA >= 0) {
        const a = tracks[rec.pinchA];
        const b = tracks[rec.pinchB];
        fillPinchScratch(rec, a, b);
        rec.opts.onPinchMove?.(pinchScratch);
        rec.prevSpan = pinchScratch.span;
        continue;
      }
      let a = null;
      let b = null;
      for (const t of tracks) {
        if (!t.used || !t.present || t.claimedBy)
          continue;
        if (!(rec.flags[t.slot] & OBSERVING))
          continue;
        if (!a)
          a = t;
        else if (!b)
          b = t;
        else
          break;
      }
      if (!a || !b) {
        clearPinchPair(rec);
        continue;
      }
      const axis = rec.opts.axis ?? "any";
      if (rec.pairA !== a.slot || rec.pairB !== b.slot) {
        rec.pairA = a.slot;
        rec.pairB = b.slot;
        rec.baseSpan = pinchSpan(axis, a, b);
        rec.baseCx = (a.x + b.x) / 2;
        rec.baseCy = (a.y + b.y) / 2;
        rec.prevSpan = rec.baseSpan;
        continue;
      }
      const span = pinchSpan(axis, a, b);
      const dspan = span - rec.baseSpan;
      const absDspan = dspan < 0 ? -dspan : dspan;
      const slop = rec.opts.pinchSlop ?? DEFAULT_PINCH_SLOP;
      if (absDspan <= slop)
        continue;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const travelX = cx - rec.baseCx;
      const travelY = cy - rec.baseCy;
      const travel = axis === "y" ? travelY < 0 ? -travelY : travelY : axis === "x" ? travelX < 0 ? -travelX : travelX : Math.sqrt(travelX * travelX + travelY * travelY);
      if (absDspan < travel)
        continue;
      rec.pinchA = a.slot;
      rec.pinchB = b.slot;
      rec.flags[a.slot] |= TAP_DEAD;
      rec.flags[b.slot] |= TAP_DEAD;
      claim(a, rec);
      claim(b, rec);
      fillPinchScratch(rec, a, b);
      rec.opts.onPinchStart?.(pinchScratch);
      rec.prevSpan = pinchScratch.span;
    }
  }
  function recognize(t) {
    const moved = t.fdx !== 0 || t.fdy !== 0;
    const adx = t.dx < 0 ? -t.dx : t.dx;
    const ady = t.dy < 0 ? -t.dy : t.dy;
    for (const rec of t.owners) {
      const f = rec.flags[t.slot];
      if (!(f & OBSERVING))
        continue;
      if (moved)
        rec.opts.onMove?.(t);
      const slop = rec.opts.tapSlop ?? DEFAULT_TAP_SLOP;
      if (!(f & TAP_DEAD) && (adx > slop || ady > slop)) {
        rec.flags[t.slot] |= TAP_DEAD;
      }
    }
    if (!t.claimedBy) {
      for (const rec of t.owners) {
        const f = rec.flags[t.slot];
        if (!(f & OBSERVING) || f & (TAP_DEAD | LONGPRESS_FIRED))
          continue;
        if (!rec.opts.onLongPress)
          continue;
        const deadline = Math.max(1, Math.round((rec.opts.longPressSeconds ?? DEFAULT_LONG_PRESS_S) * simulationHz()));
        if (t.frames < deadline)
          continue;
        rec.flags[t.slot] |= LONGPRESS_FIRED;
        rec.opts.onLongPress(t);
        claim(t, rec);
        break;
      }
    }
    if (!t.claimedBy) {
      for (const rec of t.owners) {
        const f = rec.flags[t.slot];
        if (!(f & OBSERVING) || f & PANNING)
          continue;
        if (!rec.opts.onPanStart && !rec.opts.onPanMove && !rec.opts.onPanEnd)
          continue;
        const slop = rec.opts.panSlop ?? DEFAULT_PAN_SLOP;
        if (adx <= slop && ady <= slop)
          continue;
        const axis = rec.opts.axis ?? "any";
        if (axis === "y" ? ady < adx : axis === "x" ? adx < ady : false) {
          continue;
        }
        rec.flags[t.slot] |= PANNING | TAP_DEAD;
        rec.opts.onPanStart?.(t);
        claim(t, rec);
        break;
      }
    }
    for (const rec of t.owners) {
      if ((rec.flags[t.slot] & (OBSERVING | PANNING)) === (OBSERVING | PANNING)) {
        rec.opts.onPanMove?.(t);
      }
    }
  }
  function finishTrack(t) {
    for (const rec of t.owners) {
      if (rec.pinchA === t.slot || rec.pinchB === t.slot)
        endPinch(rec);
    }
    for (const rec of t.owners) {
      const f = rec.flags[t.slot];
      if (!(f & OBSERVING))
        continue;
      rec.opts.onUp?.(t);
      if (f & PANNING)
        rec.opts.onPanEnd?.(t);
    }
    if (!t.claimedBy) {
      for (const rec of t.owners) {
        const f = rec.flags[t.slot];
        if (!(f & OBSERVING) || f & (TAP_DEAD | LONGPRESS_FIRED | PANNING))
          continue;
        if (!rec.opts.onTap)
          continue;
        rec.opts.onTap(t);
        break;
      }
    }
    releaseTrack(t);
  }
  function __runGestures() {
    const snap = __allTouches();
    if (snap.length === 0 && liveCount === 0)
      return;
    const cancelled = __cancelledTouches();
    for (const t of tracks) {
      if (t.used && cancelled.some((c) => c.surface === t.surface && c.id === t.id)) {
        for (const rec of t.owners)
          if (rec.flags[t.slot] & OBSERVING)
            fireCancel(rec, t);
        releaseTrack(t);
      } else if (t.used && !snap.some((c) => c.surface === t.surface && c.id === t.id))
        finishTrack(t);
      t.present = false;
    }
    for (const c of snap) {
      let found = null;
      for (const t of tracks) {
        if (t.used && t.surface === c.surface && t.id === c.id) {
          found = t;
          break;
        }
      }
      if (found) {
        updateTrack(found, c.x, c.y);
        continue;
      }
      let free = null;
      for (const t of tracks) {
        if (!t.used) {
          free = t;
          break;
        }
      }
      if (free)
        beginTrack(free, c.surface, c.id, c.x, c.y, c.hit);
    }
    for (const t of tracks) {
      if (t.used && !t.present)
        finishTrack(t);
    }
    recognizePinches();
    for (const t of tracks) {
      if (t.used && t.present)
        recognize(t);
    }
  }
  function cancelContactsFor(rec) {
    for (const t of tracks) {
      if (t.used && rec.flags[t.slot] & OBSERVING)
        fireCancel(rec, t);
    }
  }
  function attachGesture(opts) {
    const rec = {
      opts,
      disposed: false,
      flags: new Uint8Array(MAX_TRACKS),
      pairA: -1,
      pairB: -1,
      baseSpan: 0,
      baseCx: 0,
      baseCy: 0,
      prevSpan: 0,
      pinchA: -1,
      pinchB: -1
    };
    recognizers.push(rec);
    return {
      dispose() {
        if (rec.disposed)
          return;
        cancelContactsFor(rec);
        endPinch(rec);
        rec.disposed = true;
        const i = recognizers.lastIndexOf(rec);
        if (i >= 0)
          recognizers.splice(i, 1);
      },
      cancel() {
        if (!rec.disposed)
          cancelContactsFor(rec);
      },
      get panning() {
        for (const t of tracks) {
          if (t.used && rec.flags[t.slot] & PANNING)
            return true;
        }
        return false;
      },
      get pinching() {
        return rec.pinchA >= 0;
      }
    };
  }
  function resetGestures() {
    recognizers.length = 0;
    blockDepth = 0;
    liveCount = 0;
    for (const t of tracks) {
      t.used = false;
      t.present = false;
      t.owners.length = 0;
      t.claimedBy = null;
    }
  }

  // vendor/pocketjs/framework/src/gesture.ts
  function createGesture(opts) {
    const handle = attachGesture(opts);
    onCleanup(() => handle.dispose());
    return handle;
  }

  // vendor/pocketjs/framework/src/touch-activation.ts
  function installTouchActivation() {
    const install = (surface) => createGesture({
      surface,
      onDown: (c) => {
        const target = touchFocusable(c.x, c.y, c.hit, c.surface);
        if (target)
          setActiveNode(target);
      },
      onTap: (c) => {
        setActiveNode(null);
        const target = touchFocusable(c.x, c.y, c.hit, c.surface);
        if (target)
          pressNode(target);
      },
      onUp: () => setActiveNode(null),
      onCancel: () => setActiveNode(null)
    });
    const primary = install("primary");
    const auxiliary = install("auxiliary");
    return {
      dispose() {
        primary.dispose();
        auxiliary.dispose();
      },
      cancel() {
        primary.cancel();
        auxiliary.cancel();
      },
      get panning() {
        return primary.panning || auxiliary.panning;
      },
      get pinching() {
        return primary.pinching || auxiliary.pinching;
      }
    };
  }

  // vendor/pocketjs/framework/src/effects.ts
  var nextId2 = 1;
  var pending7 = new Map;
  var queue = [];
  function traceSink() {
    const s = globalThis.__pocketEffectTrace;
    return typeof s === "function" ? s : null;
  }
  function resetEffects() {
    nextId2 = 1;
    pending7.clear();
    queue = [];
  }
  function __drainEffects() {
    if (queue.length === 0)
      return;
    const batch = queue;
    queue = [];
    for (const {
      id,
      result
    } of batch) {
      const entry = pending7.get(id);
      if (!entry)
        continue;
      pending7.delete(id);
      traceSink()?.({
        t: "delivery",
        frame: virtualFrame(),
        id,
        kind: entry.kind
      });
      entry.onResult(result);
    }
  }

  // vendor/pocketjs/framework/src/services.ts
  var pumps = new Set;
  function runServicePumps() {
    if (pumps.size === 0)
      return;
    for (const pump of pumps)
      pump();
  }

  // vendor/pocketjs/framework/src/system-layers.ts
  var layers = [];
  var filter = null;
  var input = {
    buttons: 0,
    touches: undefined,
    hits: undefined,
    surfaces: undefined
  };
  function mountSystemLayers(ops) {
    const disposers = [];
    for (const layer of layers) {
      const dispose = layer(ops);
      if (dispose)
        disposers.push(dispose);
    }
    return () => {
      for (const dispose of disposers.splice(0).reverse())
        dispose();
      filter = null;
    };
  }
  function filterFrameInput(buttons, touches, hits, surfaces) {
    if (filter === null)
      return null;
    input.buttons = buttons;
    input.touches = touches;
    input.hits = hits;
    input.surfaces = surfaces;
    filter(input);
    return input;
  }

  // pocketjs-generated-styles:/Users/evan/code/omarchy-pocket/vendor/pocketjs/framework/src/styles.generated.ts
  var STYLE_IDS = {
    "absolute left-0 top-0 w-[512] h-[384]": 0,
    "absolute left-0 top-0 w-[512] h-[384] contain-strict": 1,
    "absolute left-0 w-[512] overflow-hidden contain-strict": 2,
    "absolute left-0 top-0 w-[512] contain-strict": 3,
    "relative flex-col w-full h-full bg-slate-50 overflow-hidden": 4,
    "absolute inset-0 z-50 flex-col items-center justify-center": 5,
    "absolute inset-0 bg-slate-950": 6,
    "flex-col gap-2 w-[328] p-3 rounded-xl shadow-lg bg-white border-slate-200": 7,
    "absolute left-3 right-3 bottom-3 flex-row items-center justify-between px-2 py-1 rounded-lg shadow-md bg-white border-slate-200": 8,
    "flex-row flex-wrap": 9,
    grow: 10,
    "absolute left-0 text-center font-mono text-xs leading-[14]": 11,
    "absolute right-[12] top-[6] font-mono text-sm leading-[16]": 12,
    "absolute left-0 top-0 w-[512] h-[18] contain-strict": 13,
    "absolute top-[2] font-mono text-xs leading-[14]": 14,
    "absolute left-0 top-[2] w-[512] text-center font-mono text-xs leading-[14]": 15,
    "absolute right-[8] top-[2] font-mono text-xs leading-[14]": 16,
    "absolute left-0 top-0 w-[512] h-[350] contain-strict": 17,
    "absolute left-0 top-0 w-[360] h-[296] contain-strict": 18,
    "absolute left-[8] top-[25] w-[344] h-[1]": 19,
    "absolute left-[12] top-[6] font-mono text-sm leading-[16]": 20,
    "absolute left-[8] top-[25] w-[496] h-[1]": 21,
    "absolute left-[8] w-[496] h-[22]": 22,
    "absolute left-0 top-0 w-[496] h-[22] rounded-sm": 23,
    "absolute left-[8] top-[4] w-[20] font-mono text-sm leading-[14]": 24,
    "absolute left-[34] top-[4] font-mono text-sm leading-[14]": 25,
    "absolute right-[8] top-[4] font-mono text-sm leading-[14]": 26,
    "absolute left-0 top-[298] w-[512] h-[20]": 27,
    "absolute left-[12] top-[3] font-mono text-xs leading-[14]": 28,
    "absolute top-[288] h-[48] overflow-hidden rounded-md border-[1]": 29,
    "absolute left-[12] top-[10] w-[28] text-center text-2xl leading-[28]": 30,
    "absolute left-[52] top-[22] w-[120] h-[4]": 31,
    "absolute right-[12] top-[15] font-mono text-base leading-[18]": 32,
    "absolute left-[48] top-[15] font-mono text-base leading-[18]": 33,
    "absolute right-[8] w-[248] h-[52] overflow-hidden rounded-md border-[1]": 34,
    "absolute left-[10] top-[8] w-[18] font-mono text-sm leading-[16]": 35,
    "absolute left-[32] top-[8] w-[136] h-[16] overflow-hidden font-mono text-sm leading-[16]": 36,
    "absolute right-[8] top-[9] font-mono text-xs leading-[14]": 37,
    "absolute left-[32] top-[28] w-[206] h-[16] overflow-hidden font-mono text-xs leading-[14]": 38,
    "absolute left-0 top-[118] w-[512] text-center text-2xl leading-[28]": 39,
    "absolute left-0 top-[160] w-[512] text-center text-2xl leading-[28]": 40,
    "absolute left-0 top-[202] w-[512] text-center font-mono text-sm leading-[16]": 41,
    "absolute font-mono text-xs leading-[14]": 42,
    "absolute text-right font-mono text-xs leading-[14]": 43,
    "absolute h-[6] rounded-sm": 44,
    "absolute left-[12] top-[8] text-sm leading-[16]": 45,
    "absolute left-[12] top-[28] text-2xl leading-[28]": 46,
    "absolute left-[12] top-[62] font-mono text-xs leading-[14]": 47,
    "absolute text-sm leading-[16]": 48,
    "absolute rounded-sm": 49,
    absolute: 50,
    "absolute top-0 w-[2]": 51,
    "absolute font-mono text-sm leading-[16]": 52,
    "absolute left-[12] top-[8] font-mono text-xs leading-[14]": 53,
    "absolute right-[12] top-[8] font-mono text-xs leading-[14]": 54,
    "absolute left-[6] top-[3] h-[14] overflow-hidden font-mono text-sm leading-[14]": 55,
    "absolute right-[6] top-[3] font-mono text-xs leading-[14]": 56,
    "absolute left-0 text-center text-2xl leading-[28]": 57,
    "absolute left-0 h-[20] overflow-hidden text-center text-base leading-[20]": 58,
    "absolute left-0 h-[16] text-center font-mono text-sm leading-[16]": 59,
    "absolute text-center font-mono text-xs leading-[14]": 60,
    "absolute left-0 top-[4] text-center font-mono text-sm leading-[16]": 61,
    "absolute top-[6] h-[14] overflow-hidden font-mono text-xs leading-[14]": 62,
    "absolute h-[18] overflow-hidden font-mono text-sm leading-[18]": 63,
    "absolute w-[2] h-[16]": 64,
    "absolute left-[12] top-[6] font-mono text-xs leading-[14]": 65,
    "absolute left-[6] top-[4] w-[16] font-mono text-sm leading-[14]": 66,
    "absolute left-[26] top-[4] h-[14] overflow-hidden font-mono text-sm leading-[14]": 67,
    "absolute top-0 w-[1]": 68,
    "absolute left-0 top-0": 69,
    "absolute left-0 text-center font-mono text-sm leading-[16]": 70,
    "absolute left-0": 71,
    "absolute left-[8] top-[2] h-[14] overflow-hidden font-mono text-xs leading-[14]": 72,
    "absolute overflow-hidden contain-strict": 73,
    "absolute left-0 top-0 rounded-sm": 74,
    "absolute left-0 w-[512] text-center text-lg leading-[24]": 75,
    "absolute left-0 w-[512] text-center font-mono text-xs leading-[14]": 76,
    "absolute rounded-md": 77,
    "absolute left-0 text-center font-mono text-base leading-[18]": 78,
    "absolute overflow-hidden rounded-md": 79,
    "absolute left-[2] top-[2] overflow-hidden rounded-sm": 80,
    "absolute right-[12] top-[6] font-mono text-xs leading-[16]": 81,
    "absolute left-0 top-0 h-[4]": 82,
    "absolute left-[12] top-[24] w-[488] h-[348] rounded-md border-[1]": 83,
    "absolute left-[12] top-[8] font-mono text-sm leading-[16]": 84,
    "absolute right-[12] top-[9] font-mono text-xs leading-[14]": 85,
    "absolute left-[12] top-[30] w-[464] h-[1]": 86,
    "absolute bg-white": 87,
    "absolute bg-black": 88,
    "absolute left-[12] top-[60] font-mono text-xs leading-[14]": 89,
    "absolute left-[12] h-[14] overflow-hidden font-mono text-xs leading-[14] text-center": 90,
    "absolute left-0 top-0 w-[256] h-[256]": 91,
    "absolute left-[256] top-0 w-[256] h-[256]": 92,
    "absolute left-0 top-[256] w-[256] h-[128]": 93,
    "absolute left-[256] top-[256] w-[256] h-[128]": 94,
    "absolute left-0 top-0 w-[20] h-[24]": 95,
    "absolute left-[-3] top-[-2] text-xl leading-[24]": 96,
    "absolute top-[2] h-[14] w-[12] rounded-sm": 97,
    "absolute top-[2] text-right font-mono text-xs leading-[14]": 98,
    "absolute left-0 text-center text-xl leading-[24]": 99,
    "absolute left-0 h-[16] overflow-hidden text-center font-mono text-xs leading-[16]": 100,
    "absolute left-0 h-[14] overflow-hidden text-center font-mono text-xs leading-[14]": 101,
    "absolute left-0 h-[16] overflow-hidden text-center font-mono text-sm leading-[16]": 102,
    "absolute overflow-hidden rounded-md contain-strict": 103,
    "absolute left-[6] top-[1] h-[14] overflow-hidden font-mono text-xs leading-[14]": 104,
    "absolute left-0 overflow-hidden contain-strict": 105,
    "absolute top-0": 106,
    "absolute top-0 font-mono text-xs": 107,
    "absolute overflow-hidden": 108,
    "absolute h-[15] overflow-hidden font-mono text-xs leading-[15]": 109,
    "absolute text-center text-2xl leading-[28]": 110,
    "absolute text-center font-mono text-base leading-[18]": 111,
    "absolute h-[14] overflow-hidden text-center font-mono text-xs leading-[14]": 112,
    "absolute w-[44] h-[44] rounded-full border-[1]": 113,
    "absolute w-[15] h-[15] rounded-full": 114,
    "absolute h-[15] w-[15] text-center font-mono text-xs leading-[15]": 115,
    "absolute rounded-md border-[1]": 116,
    "absolute text-center font-mono text-sm leading-[16]": 117,
    "absolute w-[152] h-[30] rounded-full border-[1]": 118,
    "absolute overflow-hidden font-mono text-xs leading-[14]": 119,
    "absolute w-[56] h-[56] rounded-full border-[1]": 120,
    "absolute w-[28] h-[28] rounded-full": 121,
    "absolute left-[156] w-[200] text-center font-mono text-base leading-[18]": 122,
    "absolute left-[2] top-[2] overflow-hidden": 123,
    "absolute left-0 text-center font-mono text-base leading-[20]": 124,
    "absolute top-[1] w-[12] text-center font-mono text-xs leading-[12]": 125,
    "absolute top-[1] rounded-sm": 126,
    "absolute top-[7] w-[20] text-center font-mono text-base leading-[18]": 127,
    "absolute left-[34] top-[9] h-[14] overflow-hidden font-mono text-xs leading-[14]": 128,
    "absolute top-[8] w-[16] text-center font-mono text-xs leading-[16]": 129,
    "absolute overflow-hidden rounded-sm": 130,
    "absolute top-[6] w-[16] text-center font-mono text-xs leading-[16]": 131,
    "absolute left-0 top-[8] h-[16] overflow-hidden text-center font-mono text-sm leading-[16]": 132,
    "absolute left-0 top-[6] h-[16] overflow-hidden text-center font-mono text-xs leading-[16]": 133,
    "absolute left-0 top-0 w-[512]": 134,
    "absolute left-[10] top-[8] h-[18] overflow-hidden font-mono text-sm leading-[18]": 135,
    "absolute top-[8] h-[18] overflow-hidden text-center font-mono text-sm leading-[18]": 136,
    "absolute rounded-lg": 137,
    "absolute h-[28] overflow-hidden text-center font-mono text-xs leading-[14]": 138,
    "absolute text-center text-lg leading-[24]": 139,
    "absolute w-[44] h-[44] rounded-full": 140,
    "absolute left-0 top-0 w-[512] h-[384] overflow-hidden": 141
  };

  // vendor/pocketjs/framework/src/index.ts
  if (typeof globalThis.queueMicrotask !== "function") {
    globalThis.queueMicrotask = (fn) => {
      Promise.resolve().then(fn);
    };
  }
  var STYLES_KEY = "ui:styles";
  var FONT_PREFIX = "ui:font.";
  var IMG_PREFIX = "ui:img.";
  var SPRITE_PREFIX = "ui:sprite.";
  function globalOps() {
    return globalThis.ui;
  }
  function uploadPakImages(ops) {
    if (ops.__textures)
      return;
    for (const key of entries(IMG_PREFIX)) {
      const blob = get(key);
      let handle;
      if (ops.uploadImgEntry) {
        handle = ops.uploadImgEntry(blob);
      } else {
        const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
        handle = ops.uploadTexture(blob.subarray(8), dv.getUint16(0, true), dv.getUint16(2, true), blob[4]);
      }
      if (handle >= 0)
        registerTexture(key.slice(IMG_PREFIX.length), handle);
    }
  }
  function uploadPakSprites(ops) {
    if (ops.__sprites)
      return;
    for (const key of entries(SPRITE_PREFIX)) {
      const blob = get(key);
      const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
      const w = dv.getUint16(0, true);
      const h = dv.getUint16(2, true);
      const psm = blob[4];
      const frames = dv.getUint16(6, true);
      const cols = dv.getUint16(8, true);
      const step = dv.getUint16(10, true);
      const handle = ops.uploadTexture(blob.subarray(16), w, h, psm);
      if (handle >= 0) {
        registerSprite(key.slice(SPRITE_PREFIX.length), {
          handle,
          frames,
          cols,
          step
        });
      }
    }
  }
  function createLayer(style) {
    const layer = createElement2("view");
    setProp(layer, "style", style, undefined);
    return layer;
  }
  var appLayer = null;
  var overlayLayer = null;
  function resizeViewport(w, h) {
    if (!appLayer || !overlayLayer)
      return;
    setProp(appLayer, "style", {
      width: w,
      height: h,
      overflow: ENUMS.Overflow.Hidden
    }, undefined);
    setProp(overlayLayer, "style", {
      width: w,
      height: h,
      posType: ENUMS.PosType.Absolute,
      insetT: 0,
      insetR: 0,
      insetB: 0,
      insetL: 0,
      zIndex: 1000
    }, undefined);
    const ops = getOps();
    ops.__viewport = {
      w,
      h
    };
  }
  var runDeferredGestures = (defer) => withDeferredPress(defer, __runGestures);
  function render2(code, opts = {}) {
    const host = detectHost(opts.ops);
    installHost(host);
    setStyleResolver(resolveStyle);
    if (opts.styles)
      registerStyles(opts.styles);
    const nativeTextureTable = host.kind === "native" ? host.ops.__textures : undefined;
    if (host.kind === "native") {
      if (nativeTextureTable) {
        for (const key in nativeTextureTable) {
          registerTexture(key, nativeTextureTable[key]);
        }
      }
      const spr = host.ops.__sprites;
      if (spr) {
        for (const key in spr)
          registerSprite(key, spr[key]);
      }
    }
    if (host.kind === "injected" || nativeTextureTable === undefined) {
      if (opts.pak)
        loadPack(opts.pak);
      if (hasPack()) {
        for (const key of entries()) {
          if (key === STYLES_KEY) {
            host.ops.loadStyles?.(get(key));
          } else if (key.startsWith(FONT_PREFIX)) {
            host.ops.loadFontAtlas?.(get(key));
          }
        }
      }
    }
    const auxiliary = mountAuxiliarySurface(host.ops);
    const viewport = hostViewport(host.ops);
    const layerW = viewport?.w ?? SCREEN_W;
    const layerH = viewport?.h ?? SCREEN_H;
    const appRoot = createLayer({
      width: layerW,
      height: layerH,
      overflow: ENUMS.Overflow.Hidden
    });
    const overlayRoot = createLayer({
      width: layerW,
      height: layerH,
      posType: ENUMS.PosType.Absolute,
      insetT: 0,
      insetR: 0,
      insetB: 0,
      insetL: 0,
      zIndex: 1000,
      hitPass: 1
    });
    insertNode(rootMirror, appRoot);
    insertNode(rootMirror, overlayRoot);
    setOverlayRoot(overlayRoot);
    appLayer = appRoot;
    overlayLayer = overlayRoot;
    setInputRoot(appRoot);
    setHitRoot(rootMirror);
    setAuxiliaryHitRoot(auxiliary?.native ?? null);
    resetFrameHooks();
    resetGestures();
    installTouchActivation();
    resetClock();
    resetEffects();
    initDevtools(host.ops);
    installFrameHandler(wrapFrameHandler((buttons, analog, touches, hits, touchSurfaces, rightAnalog, axisDeltas, motion, text) => {
      __advanceClock();
      const filtered = filterFrameInput(buttons, touches, hits, touchSurfaces);
      if (filtered !== null) {
        buttons = filtered.buttons;
        touches = filtered.touches;
        hits = filtered.hits;
        touchSurfaces = filtered.surfaces;
      }
      __setAnalog(analog, rightAnalog);
      __setTouches(touches, hits, touchSurfaces);
      __setTextEvents(text);
      runServicePumps();
      __drainEffects();
      __dispatchTextEvents();
      runFrameHooks(buttons, axisDeltas, (defer) => handleFrame(buttons, defer), runDeferredGestures, motion);
      runSweep();
    }));
    const dispose = render(code, appRoot);
    const disposeSystemLayers = mountSystemLayers(host.ops);
    flushLifecycleHooks();
    const removeResizeViewportHook = installResizeViewportHook(resizeViewport);
    return () => {
      removeResizeViewportHook();
      disposeSystemLayers();
      __resetTouches();
      __resetTextInput();
      resetGestures();
      dispose();
      disposeRootModelRegions();
      flushUnmountedHooks();
      setInputRoot(null);
      setHitRoot(null);
      setAuxiliaryHitRoot(null);
      setOverlayRoot(null);
      appLayer = null;
      overlayLayer = null;
      for (const child of rootMirror.children.splice(0)) {
        child.parent = null;
        host.ops.destroyNode(child.id);
      }
      unmountAuxiliarySurface(host.ops);
      runSweep();
    };
  }
  function mount(code, opts = {}) {
    const ops = opts.ops ?? globalOps();
    if (!ops) {
      throw new Error("PocketJS: mount() requires globalThis.ui or opts.ops");
    }
    if (opts.pak)
      loadPack(opts.pak);
    uploadPakImages(ops);
    uploadPakSprites(ops);
    const dispose = render2(code, {
      ops,
      styles: opts.styles ?? STYLE_IDS,
      pak: opts.pak
    });
    return dispose;
  }

  // shell/src/main.tsx
  try {
    mount(() => createComponent2(Shell, {}));
  } catch (error) {
    console.log("omarchy-pocket: mount failed:", String(error), error.stack ?? "");
    throw error;
  }
})();
