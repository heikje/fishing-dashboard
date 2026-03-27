define(['leaflet'], function(L) {
	'use strict';

	function swerefToLatLong(swerefArray) {
		return L.Projection.SWEREF.unproject(new L.Point(swerefArray[0], swerefArray[1]));
	}
	
	
	function latLongToSweref(latlng) {
		return L.Projection.SWEREF.project(latlng);
	}

	
	function VisualGraph(map, data) {

		var self = this;
		this.map = map;
		this.mainLayerGroup = L.featureGroup();
		this.polygons = L.featureGroup();
		this.lineLayerGroup = L.featureGroup();
		this.visualStations = [];
		
		if(data) {
			for (var subid in data.stations) {
				this.addStationLines(this.lineLayerGroup, data, subid);
			}
	
			for (var subid2 in data.stations) {
				var station = data.stations[subid2];
				var relativeFlowScalingFactor = (station.upstreamPOI || subid2 === data.poi) ? station.normalQ / data.maxNormalQ : 0.3;
	
				var downstreamPositions = this.getDownstreamPositions(station, data);
				var visualStation = new VisualStation(subid2, station.pos.coordinates, downstreamPositions, station.values, station.relValues, relativeFlowScalingFactor);
				this.visualStations.push(visualStation);
				this.lineLayerGroup.addLayer(visualStation.getLineLayer());
	
			}
		
			this.mainLayerGroup.addLayer(this.lineLayerGroup);
		}
	}
	
	VisualGraph.prototype.bringCircleToFront = function(c) {
		this.circleLayerGroup.bringToFront();
		this.lineLayerGroup.bringToBack();
	}
	
	VisualGraph.prototype.toLatLong = function(c) {
		var polygons = [];
		for (var i in c) {
			for (var j in c[i]) {
				var polygon = [];
				for (var k in c[i][j]) {
					var point = swerefToLatLong(c[i][j][k]);
					polygon.push(point);
				}
				polygons.push(polygon);
			}
		}
		return polygons;
	};
	
	
	VisualGraph.prototype.getLayer = function() {
		return this.mainLayerGroup;
	};
	

	
	VisualGraph.prototype.getDownstreamPositions = function(station, data) {
		var result = [];
		for (var i in station.downstream) {
			var downstreamSubid = station.downstream[i];
			var downstreamStation = data.stations[downstreamSubid];
			if (typeof downstreamStation !== 'undefined') {
				result.push(downstreamStation.pos.coordinates);
			}
		}	
		return result;
	};
	
	
	VisualGraph.prototype.addStationLines = function(parentLayer, data, subid) {
		var self = this;
		var station = data.stations[subid];
		var relativeFlow = station.normalQ / data.maxNormalQ; 
	
		for (var i in station.downstream) {
			var downstreamSubid = station.downstream[i];
			var downstreamStation = data.stations[downstreamSubid];
			if (typeof downstreamStation !== 'undefined') {
				
				var color = downstreamStation.upstreamPOI ? 'rgb(1,24,1)' : 'rgb(1,24,1)';
				var fromLatLng = swerefToLatLong(station.pos.coordinates);
				var toLatLng = swerefToLatLong(downstreamStation.pos.coordinates);
				var polyline = L.polyline([fromLatLng, toLatLng], {
					weight: downstreamStation.upstreamPOI ? 1 + 10 * relativeFlow : 10,
					color: color,
					opacity: downstreamStation.upstreamPOI ? 0.8 : 0.4
				});
				

				parentLayer.addLayer(polyline);
				
			}
		}
	};
	
	
	function VisualStation(subid, position, downstreamPositions, valueArray, referenceValueArray,relativeFlowScalingFactor) {

		this.subid = subid;
		this.relativeFlowScalingFactor = relativeFlowScalingFactor;
		this.lineLayerGroup = L.featureGroup();
		this.positionLatLong = swerefToLatLong(position);		
		var self = this;

		for (var i in downstreamPositions) {
			var downstreamPositionLatLng = swerefToLatLong(downstreamPositions[i]);
			
			var polyline = L.polyline([this.positionLatLong, downstreamPositionLatLng], {
				opacity: 0.6,
				color: 'rgba(0,0,0,0)'
			});
			this.lineLayerGroup.addLayer(polyline);
		}		
		
		this.valueArray = valueArray;
		this.referenceValueArray = referenceValueArray;

		
	};
	
	
	VisualStation.prototype.getLineLayer = function() {
		return this.lineLayerGroup;
	};
	
	
	
	VisualStation.prototype.scaleStyle = function(value) {
		switch (value) {
		case 2:
			return {color: 'rgba(0,38,255,1)', extraWidth: 12};
		case 1:
			return {color: 'rgba(0,38,255,0.45)', extraWidth: 10};
		case 0:
			return {color: 'rgba(0,0,0,0)', extraWidth: 0};
		case -1:
			return {color: 'rgba(255,0,0,0.45)', extraWidth: 10};
		case -2:
			return {color: 'rgba(255,0,0,1)', extraWidth: 12};
		default:
			return {color: 'rgba(0,0,0,0)', extraWidth: 0};
		}
	};
	
	return VisualGraph;
});

