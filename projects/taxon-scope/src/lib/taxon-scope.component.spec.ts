import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TaxonScopeComponent } from './taxon-scope.component';

describe('TaxonScopeComponent', () => {
  let component: TaxonScopeComponent;
  let fixture: ComponentFixture<TaxonScopeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaxonScopeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TaxonScopeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
