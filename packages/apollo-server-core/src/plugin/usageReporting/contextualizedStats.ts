import { DurationHistogram } from './durationHistogram';
import {
  IFieldStat,
  IPathErrorStats,
  IQueryLatencyStats,
  IStatsContext,
  Trace,
  ITypeStat,
  IContextualizedStats,
  ReportHeader,
  google,
  ITracesAndStats,
  IReport,
} from 'apollo-reporting-protobuf';

// FIXME rename file

// FIXME review this comment

// protobuf.js exports both a class and an interface (starting with I) for each
// message type. For these stats messages, we create our own classes that
// implement the interfaces, so that the `repeated sint64` DurationHistogram
// fields can be built up as DurationHistogram objects rather than arrays. (Our
// fork of protobuf.js contains a change
// (https://github.com/protobufjs/protobuf.js/pull/1302) which lets you use pass
// own objects with `toArray` methods to the generated protobuf encode
// functions.) TypeScript validates that we've properly listed all of the
// message fields with the appropriate types (we use `Required` to ensure we
// implement all message fields). Using our own classes has other advantages,
// like being able to specify that nested messages are instances of the same
// class rather than the interface type and thus that they have non-null fields
// (because the interface type allows all fields to be optional, even though the
// protobuf format doesn't differentiate between missing and falsey).

// FIXME make sure we never reuse a StatsMap with multiple schemas (eg, so field
// types are consistent)
class StatsByContext {
  readonly map: { [k: string]: OurContextualizedStats } = Object.create(null);

  /**
   * This function is used by the protobuf generator to convert this map into
   * an array of contextualized stats to serialize
   */
  public toArray(): IContextualizedStats[] {
    return Object.values(this.map);
  }

  public addTrace(trace: Trace) {
    const statsContext: IStatsContext = {
      clientName: trace.clientName,
      clientVersion: trace.clientVersion,
      clientReferenceId: trace.clientReferenceId,
    };

    const statsContextKey = JSON.stringify(statsContext);

    // FIXME: Make this impact ReportData.size so that maxUncompressedReportSize
    // works.
    (
      this.map[statsContextKey] ||
      (this.map[statsContextKey] = new OurContextualizedStats(statsContext))
    ).addTrace(trace);
  }
}

class OurTracesAndStats implements Required<ITracesAndStats> {
  readonly trace: Uint8Array[] = [];
  readonly statsWithContext = new StatsByContext();
}

export class OurReport implements Required<IReport> {
  constructor(readonly header: ReportHeader) {}
  readonly tracesPerQuery: Record<
    string,
    OurTracesAndStats | undefined
  > = Object.create(null);
  public endTime: google.protobuf.ITimestamp | null = null;

  public tracesAndStatsByStatsReportKey(statsReportKey: string) {
     const existing = this.tracesPerQuery[statsReportKey];
     if (existing) {
       return existing;
     }
     return this.tracesPerQuery[statsReportKey] = new OurTracesAndStats();
  }
}


class OurQueryLatencyStats implements Required<IQueryLatencyStats> {
  latencyCount: DurationHistogram = new DurationHistogram();
  requestCount: number = 0;
  cacheHits: number = 0;
  persistedQueryHits: number = 0;
  persistedQueryMisses: number = 0;
  cacheLatencyCount: DurationHistogram = new DurationHistogram();
  rootErrorStats: OurPathErrorStats = new OurPathErrorStats();
  requestsWithErrorsCount: number = 0;
  publicCacheTtlCount: DurationHistogram = new DurationHistogram();
  privateCacheTtlCount: DurationHistogram = new DurationHistogram();
  registeredOperationCount: number = 0;
  forbiddenOperationCount: number = 0;
}

class OurPathErrorStats implements Required<IPathErrorStats> {
  children: { [k: string]: OurPathErrorStats } = Object.create(null);
  errorsCount: number = 0;
  requestsWithErrorsCount: number = 0;
}

class OurTypeStat implements Required<ITypeStat> {
  perFieldStat: { [k: string]: OurFieldStat } = Object.create(null);
}

class OurFieldStat implements Required<IFieldStat> {
  errorsCount: number = 0;
  count: number = 0;
  requestsWithErrorsCount: number = 0;
  latencyCount: DurationHistogram = new DurationHistogram();

  constructor(public readonly returnType: string) {}
}

export class OurContextualizedStats implements IContextualizedStats {
  queryLatencyStats = new OurQueryLatencyStats();
  perTypeStat: { [k: string]: OurTypeStat } = Object.create(null);

  constructor(public readonly statsContext: IStatsContext) {}

  public addTrace(trace: Trace) {
    this.queryLatencyStats.requestCount++;
    if (trace.fullQueryCacheHit) {
      this.queryLatencyStats.cacheLatencyCount.incrementDuration(
        trace.durationNs,
      );
      this.queryLatencyStats.cacheHits++;
    } else {
      this.queryLatencyStats.latencyCount.incrementDuration(trace.durationNs);
    }

    // We only provide stats about cache TTLs on cache misses (ie, TTLs directly
    // calculated by the backend), not for cache hits. This matches the
    // behavior we've had for a while when converting traces into statistics
    // in Studio's servers.
    if (!trace.fullQueryCacheHit && trace.cachePolicy?.maxAgeNs != null) {
      // FIXME Actually write trace.cachePolicy!
      switch (trace.cachePolicy.scope) {
        case Trace.CachePolicy.Scope.PRIVATE:
          this.queryLatencyStats.privateCacheTtlCount.incrementDuration(
            trace.cachePolicy.maxAgeNs,
          );
          break;
        case Trace.CachePolicy.Scope.PUBLIC:
          this.queryLatencyStats.publicCacheTtlCount.incrementDuration(
            trace.cachePolicy.maxAgeNs,
          );
          break;
      }
    }

    if (trace.persistedQueryHit) {
      this.queryLatencyStats.persistedQueryHits++;
    }
    if (trace.persistedQueryRegister) {
      this.queryLatencyStats.persistedQueryMisses++;
    }

    if (trace.forbiddenOperation) {
      this.queryLatencyStats.forbiddenOperationCount++;
    }
    if (trace.registeredOperation) {
      this.queryLatencyStats.registeredOperationCount++;
    }

    let hasError = false;

    const traceNodeStats = (node: Trace.INode, path: ResponseNamePath) => {
      // Generate error stats and error path information
      if (node.error?.length) {
        hasError = true;

        let currPathErrorStats = this.queryLatencyStats.rootErrorStats;
        path.toArray().forEach((subPath) => {
          const children = currPathErrorStats.children;
          currPathErrorStats =
            children[subPath] || (children[subPath] = new OurPathErrorStats());
        });

        currPathErrorStats.requestsWithErrorsCount += 1;
        currPathErrorStats.errorsCount += node.error.length;
      }

      // The actual field name behind the node; originalFieldName is set
      // if an alias was used, otherwise responseName. (This is falsey for
      // nodes that are not fields (root, array index, etc).)
      const fieldName = node.originalFieldName || node.responseName;

      // Protobuf doesn't really differentiate between "unset" and "falsey" so
      // we're mostly actually checking that these things are non-empty string /
      // non-zero numbers. The time fields represent the number of nanoseconds
      // since the beginning of the entire trace, so let's pretend for the
      // moment that it's plausible for a node to start or even end exactly when
      // the trace started (ie, for the time values to be 0). This is unlikely
      // in practice (everything should take at least 1ns). In practice we only
      // write `type` and `parentType` on a Node when we write `startTime`, so
      // the main thing we're looking out for by checking the time values is
      // whether we somehow failed to write `endTime` at the end of the field;
      // in this case, the `endTime >= startTime` check won't match.
      if (
        node.parentType &&
        fieldName &&
        node.type &&
        node.endTime != null &&
        node.startTime != null &&
        node.endTime >= node.startTime
      ) {
        const typeStat =
          this.perTypeStat[node.parentType] ||
          (this.perTypeStat[node.parentType] = new OurTypeStat());

        const fieldStat =
          typeStat.perFieldStat[fieldName] ||
          (typeStat.perFieldStat[fieldName] = new OurFieldStat(node.type));

        fieldStat.errorsCount += node.error?.length ?? 0;
        fieldStat.count++;
        // Note: this is actually counting the number of resolver calls for this
        // field that had at least one error, not the number of overall GraphQL
        // queries that had at least one error for this field. That doesn't seem
        // to match the name, but it does match the other implementations of this
        // logic.
        fieldStat.requestsWithErrorsCount +=
          (node.error?.length ?? 0) > 0 ? 1 : 0;
        fieldStat.latencyCount.incrementDuration(node.endTime - node.startTime);
      }

      return false;
    };

    iterateOverTraceForStats(trace, traceNodeStats, true);
    if (hasError) {
      this.queryLatencyStats.requestsWithErrorsCount++;
    }
  }
}

/**
 * Iterates over the entire trace, calling `f` on each Trace.Node found. It
 * looks under the "root" node as well as any inside the query plan. If any `f`
 * returns true, it stops walking the tree.
 *
 * Each call to `f` will receive an object that implements ResponseNamePath. If
 * `includePath` is true, `f` can call `toArray()` on it to convert the
 * linked-list representation to an array of the response name (field name)
 * nodes that you navigate to get to the node (including a "service:subgraph"
 * top-level node if this is a federated trace). Note that we don't add anything
 * to the path for index (list element) nodes. This is because the only use case
 * we have (error path statistics) does not care about list indexes (it's not
 * that interesting to know that sometimes an error was at foo.3.bar and
 * sometimes foo.5.bar, vs just generally foo.bar).
 *
 * If `includePath` is false, we don't bother to build up the linked lists, and
 * calling `toArray()` will throw.
 */
function iterateOverTraceForStats(
  trace: Trace,
  f: (node: Trace.INode, path: ResponseNamePath) => boolean,
  includePath: boolean,
) {
  const rootPath = includePath
    ? new RootCollectingPathsResponseNamePath()
    : notCollectingPathsResponseNamePath;
  if (trace.root) {
    if (iterateOverTraceNode(trace.root, rootPath, f)) return;
  }

  if (trace.queryPlan) {
    if (iterateOverQueryPlan(trace.queryPlan, rootPath, f)) return;
  }
}

// Helper for iterateOverTraceForStats; returns true to stop the overall walk.
function iterateOverQueryPlan(
  node: Trace.IQueryPlanNode,
  rootPath: ResponseNamePath,
  f: (node: Trace.INode, path: ResponseNamePath) => boolean,
): boolean {
  if (!node) return false;

  if (node.fetch?.trace?.root && node.fetch.serviceName) {
    return iterateOverTraceNode(
      node.fetch.trace.root,
      rootPath.child(`service:${node.fetch.serviceName}`),
      f,
    );
  }
  if (node.flatten?.node) {
    return iterateOverQueryPlan(node.flatten.node, rootPath, f);
  }
  if (node.parallel?.nodes) {
    // We want to stop as soon as some call returns true, which happens to be
    // exactly what 'some' does.
    return node.parallel.nodes.some((node) =>
      iterateOverQueryPlan(node, rootPath, f),
    );
  }
  if (node.sequence?.nodes) {
    // We want to stop as soon as some call returns true, which happens to be
    // exactly what 'some' does.
    return node.sequence.nodes.some((node) =>
      iterateOverQueryPlan(node, rootPath, f),
    );
  }

  return false;
}

// Helper for iterateOverTraceForStats; returns true to stop the overall walk.
function iterateOverTraceNode(
  node: Trace.INode,
  path: ResponseNamePath,
  f: (node: Trace.INode, path: ResponseNamePath) => boolean,
): boolean {
  // Invoke the function; if it returns true, don't descend and tell callers to
  // stop walking.
  if (f(node, path)) {
    return true;
  }

  return (
    // We want to stop as soon as some call returns true, which happens to be
    // exactly what 'some' does.
    node.child?.some((child) => {
      const childPath = child.responseName
        ? path.child(child.responseName)
        : path;
      return iterateOverTraceNode(child, childPath, f);
    }) ?? false
  );
}

export function traceHasErrors(trace: Trace): boolean {
  let hasErrors = false;

  function traceNodeStats(node: Trace.INode): boolean {
    if ((node.error?.length ?? 0) > 0) {
      hasErrors = true;
    }
    return hasErrors;
  }

  iterateOverTraceForStats(trace, traceNodeStats, false);
  return hasErrors;
}

interface ResponseNamePath {
  toArray(): string[];
  child(responseName: string): ResponseNamePath;
}

const notCollectingPathsResponseNamePath: ResponseNamePath = {
  toArray() {
    throw Error('not collecting paths!');
  },
  child() {
    return this;
  },
};

type CollectingPathsResponseNamePath =
  | RootCollectingPathsResponseNamePath
  | ChildCollectingPathsResponseNamePath;
class RootCollectingPathsResponseNamePath implements ResponseNamePath {
  toArray() {
    return [];
  }
  child(responseName: string) {
    return new ChildCollectingPathsResponseNamePath(responseName, this);
  }
}
class ChildCollectingPathsResponseNamePath implements ResponseNamePath {
  constructor(
    readonly responseName: string,
    readonly prev: CollectingPathsResponseNamePath,
  ) {}
  toArray() {
    const out = [];
    let curr: CollectingPathsResponseNamePath = this;
    while (curr instanceof ChildCollectingPathsResponseNamePath) {
      out.push(curr.responseName);
      curr = curr.prev;
    }
    return out.reverse();
  }
  child(responseName: string) {
    return new ChildCollectingPathsResponseNamePath(responseName, this);
  }
}
