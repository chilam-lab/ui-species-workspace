import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { HierarchyStart } from '../models/hierarchy.models';

@Injectable({ providedIn: 'root' })
export class TaxonChannelService {

  // ✅ Subject privado: nadie externo lo puede next/complete por accidente
  private readonly startFromSubject = new Subject<HierarchyStart>();

  // ✅ Observable público: los componentes solo se suscriben
  readonly startFrom$: Observable<HierarchyStart> = this.startFromSubject.asObservable();

  announceStart(payload: HierarchyStart) {
    this.startFromSubject.next(payload);
  }
}
