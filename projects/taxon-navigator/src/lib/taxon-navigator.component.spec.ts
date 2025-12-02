import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TaxonNavigatorComponent } from './taxon-navigator.component';

describe('TaxonNavigatorComponent', () => {
  let component: TaxonNavigatorComponent;
  let fixture: ComponentFixture<TaxonNavigatorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaxonNavigatorComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TaxonNavigatorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
