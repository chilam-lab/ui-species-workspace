import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { HierarchyStart } from '../models/hierarchy.models';

@Injectable({ providedIn: 'root' })
export class TaxonChannelService {
  readonly startFrom$ = new Subject<HierarchyStart>();

  announceStart(payload: HierarchyStart) {
    this.startFrom$.next(payload);
  }
}
