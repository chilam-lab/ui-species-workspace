import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TaxonSelectorComponent } from './taxon-selector.component';

describe('TaxonSelectorComponent', () => {
  let component: TaxonSelectorComponent;
  let fixture: ComponentFixture<TaxonSelectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaxonSelectorComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TaxonSelectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
