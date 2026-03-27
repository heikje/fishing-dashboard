requirejs.config({
    paths: {
        'leaflet': 'js/libs/leaflet-1-beta2/leaflet-src',
        'proj4': 'js/proj4-src',
        'proj4leaflet': 'js/libs/leaflet-1-beta2/proj4leaflet',
        'jquery': 'js/libs/jquery-2.1.1.min',
        'jqueryui': 'js/libs/jquery-ui-1.11.1.custom/jquery-ui',
        'jquery.autocomplete': 'js/libs/jquery.autocomplete',
        'underscore': 'js/libs/underscore-min'
    },
    shim: {
        'jquery.autocomplete': ['jquery'],
        'jqueryui': ['jquery'],
        'underscore': {
        	exports: '_'
        }
    }
});

require(['jquery', 'leaflet', 'underscore', 'js/VisualGraph','js/Leaflet.Vattenwebb', 'jquery.autocomplete', 'jqueryui', 'js/domReady!'], function($, L, _, VisualGraph) {
	'use strict';

	fetch('/webservices/prodchain/api/v1/prodchain/metadata.json')
    .then(response => response.json())
    .then((json) => {
        document.getElementById("hypeModelVersion").innerHTML = json.hype.modelVersion;
        document.getElementById("hypeProgramVersion").innerHTML = json.hype.programVersion;
        document.getElementById("hypeSimulationPeriodStart").innerHTML = json.hype.simulationPeriod[0];
        document.getElementById("kustzonProgramVersion").innerHTML = json.kustzon.programVersion;
        document.getElementById("kustzonSimulationPeriodStart").innerHTML = json.kustzon.simulationPeriod[0];
        document.getElementById("svarProgramVersion").innerHTML = json.svar.programVersion;
    })
    .catch(error => console.error(error));

    var map;
    var treeLayer,featureLayer,municipalityLayer;
    var currentFeature;
	    
    var templates = {
    	shype_popup: _.template($("#modeller-popup-shype-tmpl").html()),
    	kz_popup: _.template($("#modeller-popup-kz-tmpl").html()),
    	municipality_popup: _.template($("#municipality-tmpl").html())
    };
	
	function showSpinner() {
        $('#spinner').addClass('show');
	}
		
	function hideSpinner() {
        $('#spinner').removeClass('show');
	}
	
	function coordsToLatLng(coords) {
		return map.options.crs.unproject(L.point(coords));
	}

	
    function initMap() {
	var map = new L.Map.VWMap('map').fitSweden();
        map.on('zoom', (event) => {
            if (currentFeature != null)
                updateHydrologicTreeLayer();
        });
	L.control.zoom({ position: 'bottomright' }).addTo(map);
        Window.map = map;
	return map;
    }
	
    function clearMap() {
    	map.closePopup();
	if(municipalityLayer && map.hasLayer(municipalityLayer)) {
	    map.removeLayer(municipalityLayer);
	}
	if(featureLayer && map.hasLayer(featureLayer)) {
	    map.removeLayer(featureLayer);
	}
        if(treeLayer && map.hasLayer(treeLayer)) {
	    map.removeLayer(treeLayer);
	}
    }
    
    function municipalityBasin(feature,name) {
        clearMap();
        municipalityLayer = L.featureGroup();
        let geojson = L.geoJson(feature, {
    	    coordsToLatLng: coordsToLatLng,
    	    style: {
    	    	fillColor: '#4080FF',
    	    	color: '#4080FF',
    	    	fillOpacity: 0.4,
    	    	weight: 2
    	    }
    	});

        municipalityLayer.addLayer(geojson);

        let popupInfo = {
            kommunnamn: `${feature[0].properties.name}`,
            municipalityUrl: `/webservices/download/api/v1/excel/municipality/code/${ feature[0].properties.code }`,
            filename: `${feature[0].properties.name}.zip`
        };
        let content = templates.municipality_popup(popupInfo);
        let popup = L.popup({minWidth: 440,autoPanPadding: L.point(10,10)})
	    .setLatLng(municipalityLayer.getBounds().getCenter())
	    .setContent(content)
	    .openOn(map);

        municipalityLayer.bindPopup(popup);

        map.addLayer(municipalityLayer);
        map.fitBounds(municipalityLayer.getBounds());
    }
    
    function shypePopup(feature, layer) {
	    if(!feature.properties.name)
	    	feature.properties.name= '';
	    if(!feature.properties.haroNumber)
	    	feature.properties.haroNumber = '';

	    if(feature.properties.subbasinarea)
	    	feature.properties.subbasinarea = new Number(feature.properties.subbasinarea / 1E6).toLocaleString();
	    if(feature.properties.subbasinlakepercentage)
	    	feature.properties.subbasinlakepercentage = new Number(feature.properties.subbasinlakepercentage).toLocaleString();
	    if(feature.properties.upstreamarea)
	    	feature.properties.upstreamarea = new Number(feature.properties.upstreamarea / 1E6).toLocaleString();
	    if(feature.properties.upstreamlakepercentage)
	    	feature.properties.upstreamlakepercentage = new Number(feature.properties.upstreamlakepercentage).toLocaleString();

        let baseUrl =  "/webservices/download/api/v1/excel/";
	    var model = $.extend({
                excelUrl: baseUrl + (feature.properties.eucd != null ? ( "/coastal/waterbody/byEUCD/" + feature.properties.eucd ) : ( "/land/basin/bySubid/" + feature.properties.subid )),
                filename: feature.properties.eucd != null ? `${feature.properties.eucd}-${feature.properties.name}.xls`  : `${feature.properties.subid}.xls`
	    }, feature.properties);

	    var content = templates.shype_popup(model);
		layer.bindPopup(content, {
			minWidth: 440,
			autoPanPadding: L.point(10,10)
		});
	}

    function kustzonPopup(feature, layer) {

    	feature.properties.volume = new Number(feature.properties.volume).toLocaleString();
    	feature.properties.maxDepth = new Number(feature.properties.waterbody.maxDepth).toLocaleString();

        let baseUrl = "/webservices/download/api/v1/excel/";
    	var model = $.extend({
            excelUrl: baseUrl + (feature.properties.district ? ( "/coastal/waterbody/byEUCD/" + feature.properties.eucd ) : ( "/land/basin/bySubid/" + feature.properties.subid )),
            filename: `${feature.properties.eucd} - ${feature.properties.name}.xls`
    	}, feature.properties);
    	
    	var content = templates.kz_popup(model);
    	layer.bindPopup(content, {
    		minWidth: 440,
    		autoPanPadding: L.point(10,10)
    	});
    }
    
	    
	function ajax(url, options) {
		return $.ajax(url, $.extend({
			dataType: 'json',
			beforeSend: showSpinner
		}, options)).always(hideSpinner);
	}

    function queryAll(url) {
        return ajax(url)
            .success((response) => {
                const res = response[0] != null ? response[0] : response;

                if (res.properties.county != null) {
                    municipalityBasin(response, $('#searchField').val());
                }else {
                    onBasin(response);
                }
            })
            .error((err) => console.log(err))
            .done(function(json) {
	});
    }

    function ajaxPromise(uri, options) {
        return new Promise((resolve, reject) => {
            ajax(uri, options)
                .success((result) => resolve(result))
                .error((_, _status, err) => reject(err));
        });
    }

    function updateHydrologicTreeLayer() {
        const subid = currentFeature.properties.subid;

        const zoomLevel = map._zoom;
        console.log(`Update ${subid} zoom level ${zoomLevel}`)

        // Remove old and create new tree layer
        //map.remove(treeLayer);
        treeLayer.clearLayers();

        // query new tree
        ajaxPromise(`/webservices/features/api/v1/hydrologicTree/feature/bySubid/${ subid }?zoom=${ zoomLevel }`, {
            context: this
        }).then((treeFeature) => {
            L.geoJson(treeFeature, {
		coordsToLatLng: coordsToLatLng,
		style: {
                    stroke: false,
                    fill: true,
		    fillColor: '#000000',
		    fillOpacity: 0.6,
		    clickable: false,
		    interactive: false,
		},
	    }).eachLayer((layer) => {
                treeLayer.addLayer(layer);
	    });
        });

    }

    function onBasin(feature, popupLatLong) {
        const isCoastalFeature = (feature.properties.eucd != null);        currentFeature = feature;
        let upstreamPromise = null;
        let featurePromise = null;

        if (!isCoastalFeature) {
            const subid = feature.properties.subid;
            const aroid = feature.properties.aroid;
            const haro = feature.properties.haro;

            const basinPromise = ajaxPromise(`/webservices/core/api/v1/data/basin/bySubid/${ subid }`, {
                context: this
            });

            const basinSoilAndLandUsagePromise = ajaxPromise(`/webservices/core/api/v1/data/basin/usage/bySubid/${ subid }`, {
                context: this
            });

            const outletPromise = ajaxPromise(`/webservices/features/api/v1/outlet/feature/byAroId/${ aroid }`, {
                context: this
            });

            const haroPromise = haro != null ? ajaxPromise(`/webservices/core/api/v1/data/haro/byHaroid/${ haro }`, {
                context: this
            }) : null;

            upstreamPromise = ajaxPromise(`/webservices/prodchain/api/v1/upstream/feature/bySubid/${ subid }`, {
                context: this
            }).then((feature) => [feature]);

            featurePromise = new Promise((resolve, reject) => {
                Promise.allSettled([basinPromise, basinSoilAndLandUsagePromise, haroPromise, outletPromise])
                    .then(([basin, usage, haro, outlet]) => {

                        if (basin.status == "rejected")
                            reject(basin.reason)
                        if (usage.status == "rejected")
                            reject(usage.reason)
                        if (haro.status == "rejected")
                            reject(haro.reason)

                        feature.properties.basin = basin.value;
                        feature.properties.soilAndLandUsage = usage.value;
                        feature.properties.haro = haro.value;

                        if (outlet.status == "fulfilled")
                            feature.properties.outlet = outlet.value;
                        else
                            feature.properties.outlet = null;

                        resolve(feature);
                    });
            });

        } else {
            const aroid = feature.properties.aroid;
            const eucd = feature.properties.eucd;

            const waterbodyPromise = ajaxPromise(`/webservices/core/api/v1/data/coast/byEUCD/${ eucd }`, {
                context: this
            });

            featurePromise = new Promise((resolve, reject) => {

                Promise.all([waterbodyPromise])
                    .then(([waterbody]) => {
                        feature.properties.waterbody = waterbody;
                        resolve(feature);
                    });
            });
        }

        // clear map of all drawings
	clearMap();
        featureLayer = L.featureGroup();
        map.addLayer(featureLayer);
        treeLayer = L.featureGroup();
        map.addLayer(treeLayer);

        if (feature.properties.subid) {
            updateHydrologicTreeLayer();
        }

        if (upstreamPromise) {
            // Request upstream geometries and add each to layer
            upstreamPromise.then((upstreamFeatures) => {
                console.log("upstream", upstreamFeatures);
                upstreamFeatures.forEach((upstreamFeature) => {
                    L.geoJson(upstreamFeature, {
		        coordsToLatLng: coordsToLatLng,
		        style: {
		            fillColor: '#4080FF',
		            color: '#4080FF',
		            fillOpacity: 0.1,
		            dashArray: '5',
		            weight: 2,
		            clickable: false,
		        interactive: false,
		        }
	            }).eachLayer((layer) => {
                        featureLayer.addLayer(layer);
	            });
                });
            });
        }

        // request metadata and add to basin feature
        if (featurePromise) {
            featurePromise.then((feature) => {
                console.log("Resolved feature: ", feature);

                L.geoJson(feature, {
                    coordsToLatLng: coordsToLatLng,
                    onEachFeature: isCoastalFeature ? kustzonPopup : shypePopup,
                    style: {
                        fillColor: '#4080FF',
                        color: '#4080FF',
                        fillOpacity: 0.4,
                        weight: 2
                    },
                }).eachLayer((layer) => {
                    featureLayer.addLayer(layer);
                    layer.openPopup(popupLatLong);
                });
            });
        }
    }
	    
    function onclick(evt) {
    	map.closePopup();
	var coord = map.options.crs.project(evt.latlng);

        ajaxPromise(`/webservices/features/api/v1/geometries/attributes/intersection?longitude=${ coord.x }&latitude=${ coord.y }`,{
            context: this,
        }).then((attributes) => {
            if (attributes.coastal != null) {
                // Prioritize view of costal waterbody if intersected
                return ajaxPromise(`/webservices/features/api/v1/kustzon/feature/byEUCD/${ attributes.coastal[0].eucd }`, { context: this })
            } else if (attributes.daro != null) {
                // otherwise we do the intersected daro
                return ajaxPromise(`/webservices/features/api/v1/daro/feature/bySubid/${ attributes.daro[0].subid }`, { context: this });
            } else {
                throw new Error("No daro or coastal waterbody resolved from intersection");
            }
        }).catch((err) => {
            console.error(`Failed to resolve feature for coord ${ coord.x },${ coord.y } with reason: ${err}`);
        }).then((feature) => {
            if (feature)
                onBasin(feature, evt.latlng);
        });
    }
	
    map = initMap();
    map.on('click', onclick);
    function escapeHandler(e) {
		if(e.keyCode === 27) {
			map.closePopup(e.data);
		}
	}
    map.on('popupopen', function(evt) {
    	$('#map').on('keydown', evt.popup, escapeHandler);
    });
    map.on('popupclose', function(evt) {
    	$('#map').off('keydown', escapeHandler);
    });

    $("#info-link").on('click', function() {
		$("#info-dialog").dialog({
		    title: '',
		    closeText: '',
		    modal: true,
		    resizable: false,
		    width: 760,
		    draggable: false
		});
		return false;
    });

    let searchAbortController = null;

    function fetchPromise(uri, options) {
        return fetch(uri, {
            ...options,
            signal: searchAbortController && searchAbortController.signal || null,
        }).then((response) => {
            if (!response.ok) {
                throw new Error(`Response status: ${response.status}`);
            }
            return response.json();
        }).then((data) =>
            data
        ).catch((err) => {});
    }
    
    $("#searchField").autocomplete({
        lookup: function (query, done) {
            if (searchAbortController != null)
                searchAbortController.abort("new search");

            searchAbortController = new AbortController();

            const promiseBasins = fetchPromise(`/webservices/core/api/v1/data/basin/search/${query}`, {});
            const promiseWaterbodies = fetchPromise(`/webservices/core/api/v1/data/coast/search/${query}`, {});
            const promiseMunicipalities = fetchPromise(`/webservices/core/api/v1/data/municipality/search/${query}`, {});


            const searchPromise = new Promise((resolve, reject) => {
                Promise.all([promiseBasins, promiseWaterbodies, promiseMunicipalities])
                    .then(([basins, waterbodies, municipalities]) => {

                        const suggestions = [];

                        if (basins) {
                            basins.forEach((basin) => {
                                suggestions.push({
                                    poi: basin,
                                    url: `/webservices/features/api/v1/daro/feature/bySubid/${ basin.subid }?land=true&ignoreExclusionFile=false`,
                                    id: basin.subid,
                                    secondId: basin.aroid,
                                    type: "DelavrinningsomrÃ¥de"
                                });
                            });
                        }

                        if (waterbodies) {
                            waterbodies.forEach((waterbody) => {
                                suggestions.push({
                                    poi: waterbody,
                                    url: `/webservices/features/api/v1/coastal/feature/byEUCD/${ waterbody.eucd }`,
                                    id: waterbody.basinId,
                                    secondId: waterbody.eucd,
                                    type: "KustvattenfÃ¶rekomst"
                                })
                            });
                        }

                        if (municipalities) {
                            municipalities.forEach((municipality) => {
                                suggestions.push({
                                    poi: municipality,
                                    url: `/webservices/features/api/v1/municipality/feature/byMunicipalityCode/${ municipality.code }`,
                                    id: municipality.code,
                                    secondId: null,
                                    type: "Kommun"
                                })
                            });
                        }
                        resolve(suggestions);
                    });
            }).catch((err) => {
                console.error(error);
            });
            searchPromise.then((suggestions) => {
                const response = {
                    suggestions: $.map(suggestions, function(dataItem) {
                        return { value: dataItem.poi.name, url: dataItem.url, id: dataItem.id, secondId: dataItem.secondId, type: dataItem.type };
                    })
                };
                done(response);
            });
        },
    	onSelect : function(item) {
    	    queryAll(item.url);
	},
        preserveInput: true,
	noCache: true,
	formatResult: function(suggestion, currentValue) {
            let formattedHtml = `
                    <div class="title">${suggestion.value}</div>
                    <div class="subtitle">${suggestion.type}</div>
            `;
            if (suggestion.type != "Kommun") {
                formattedHtml += `
                                 <div class="content">${suggestion.id}</div>
                                 <div class="content">${suggestion.secondId}</div>
                                 `;
            }

            return formattedHtml;
	},
    	triggerSelectOnValidInput: false,
    	minChars:1
    });
    
    $("#startTip").fadeIn(2000).fadeOut(8000);
    
    if(window.location.hash) {
    	query(window.location.hash.substring(1));
    }
});

